import { useRef, useEffect, useMemo, useState } from "react";
import { useQuery } from "@apollo/client";
import * as Sentry from "@sentry/react-native";
import { useNetworkState } from "~/stores";
import useShallowMemo from "./useShallowMemo";

// Constants for retry configuration
const MAX_RETRIES = 5;
const INITIAL_BACKOFF_MS = 1000; // 1 second
const MAX_BACKOFF_MS = 30000; // 30 seconds

const DEFAULT_CONTEXT = {};
const DEFAULT_SHOULD_INCLUDE_ITEM = () => true;

/**
 * Hook that queries for items with custom sorting (e.g., acknowledged first, then by newest)
 * while still using ID-based cursor for subscriptions to new items.
 *
 * This pattern handles cases where UI display order differs from subscription cursor order.
 * Items in the UI can be sorted by multiple criteria (primary: acknowledged, secondary: id),
 * but the subscription still uses a consistent, incrementing ID field for the cursor.
 */
export default function useLatestWithSubscription(
  initialQuery,
  subscription,
  {
    cursorVar = "cursor",
    cursorKey = "id",
    uniqKey = "id",
    variables: paramVariables = {},
    skip = false,
    subscriptionKey = "default",
    context = DEFAULT_CONTEXT,
    shouldIncludeItem = DEFAULT_SHOULD_INCLUDE_ITEM,
    maxRetries = MAX_RETRIES,
    livenessStaleMs = null,
    livenessCheckEveryMs = 15_000,
    ...queryParams
  } = {},
) {
  const variables = useShallowMemo(() => paramVariables, paramVariables);

  const { wsClosedDate, wsConnected } = useNetworkState([
    "wsClosedDate",
    "wsConnected",
  ]);

  // State to force re-render and retry subscription
  const [retryTrigger, setRetryTrigger] = useState(0);

  const variableHashRef = useRef(JSON.stringify(variables));
  const highestIdRef = useRef(null);
  const initialSetupDoneRef = useRef(false);
  const wasLoadingRef = useRef(true);
  const retryCountRef = useRef(0);
  const subscriptionErrorRef = useRef(null);
  const timeoutIdRef = useRef(null);
  const unsubscribeRef = useRef(null);

  // Avoid resubscribe loops caused by unstable inline params (object/function identity).
  // We deliberately do NOT put these in the subscribe effect dependency array.
  const contextRef = useRef(context);
  const shouldIncludeItemRef = useRef(shouldIncludeItem);
  useEffect(() => {
    contextRef.current = context;
  }, [context]);
  useEffect(() => {
    shouldIncludeItemRef.current = shouldIncludeItem;
  }, [shouldIncludeItem]);

  // Per-subscription liveness watchdog
  const lastSubscriptionDataAtRef = useRef(Date.now());
  const lastLivenessKickAtRef = useRef(0);

  useEffect(() => {
    if (!livenessStaleMs) return;
    if (skip) return;

    const interval = setInterval(() => {
      if (!wsConnected) return;
      const age = Date.now() - lastSubscriptionDataAtRef.current;
      if (age < livenessStaleMs) return;

      const now = Date.now();
      if (now - lastLivenessKickAtRef.current < livenessStaleMs) return;
      lastLivenessKickAtRef.current = now;

      console.warn(
        `[${subscriptionKey}] Liveness stale (${age}ms >= ${livenessStaleMs}ms), forcing resubscribe`,
      );
      lastSubscriptionDataAtRef.current = now;
      setRetryTrigger((prev) => prev + 1);
    }, livenessCheckEveryMs);

    return () => clearInterval(interval);
  }, [
    livenessStaleMs,
    livenessCheckEveryMs,
    skip,
    subscriptionKey,
    wsConnected,
  ]);

  useEffect(() => {
    const currentVarsHash = JSON.stringify(variables);
    if (currentVarsHash !== variableHashRef.current) {
      console.log(
        `[${subscriptionKey}] Variables changed, resetting subscription setup`,
      );
      highestIdRef.current = null;
      variableHashRef.current = currentVarsHash;
      initialSetupDoneRef.current = false;
      wasLoadingRef.current = true;
    }
  }, [variables, subscriptionKey]);

  const {
    data: queryData,
    loading,
    error,
    subscribeToMore,
  } = useQuery(initialQuery, {
    ...queryParams,
    variables,
    fetchPolicy: queryParams.fetchPolicy || "cache-and-network",
    skip,
    context: {
      ...context,
      subscriptionKey,
    },
  });

  // Extract highest ID from the query results (which are in DESC order)
  useEffect(() => {
    if (!queryData) return;

    const queryRootKey = Object.keys(queryData)[0];
    if (!queryRootKey) return;

    const items = queryData[queryRootKey] || [];
    // Filter out optimistic items
    const nonOptimisticItems = items.filter((item) => !item.isOptimistic);

    if (nonOptimisticItems.length > 0) {
      // When sorted by descending order, the first item has the highest ID
      const highestItem = nonOptimisticItems[0];
      const highestId = highestItem[cursorKey];

      if (
        highestId !== undefined &&
        (highestIdRef.current === null || highestId > highestIdRef.current)
      ) {
        highestIdRef.current = highestId;
        console.log(
          `[${subscriptionKey}] Updated subscription cursor to highest ID:`,
          highestId,
        );
      }
    } else {
      // Handle empty results case - initialize with 0 to allow subscription for first item
      if (highestIdRef.current === null) {
        highestIdRef.current = 0;
        console.log(
          `[${subscriptionKey}] No initial items, setting subscription cursor to:`,
          0,
        );
      }
    }
  }, [queryData, cursorKey, subscriptionKey]);

  // Track loading changes
  useEffect(() => {
    if (wasLoadingRef.current && !loading) {
      wasLoadingRef.current = false;
    }
  }, [loading]);

  // Reset retry counter when variables change
  useEffect(() => {
    retryCountRef.current = 0;
    subscriptionErrorRef.current = null;
  }, [variables]);

  // Set up the subscription once initial query is done, or on WS reconnect, etc.
  useEffect(() => {
    if (skip) return; // If skipping, do nothing
    if (!subscribeToMore) return;
    if (highestIdRef.current === null) return; // Wait until we have the highest ID

    // Always cleanup any previous active subscription before creating a new one.
    // React only runs the cleanup returned directly from the effect.
    if (unsubscribeRef.current) {
      try {
        unsubscribeRef.current();
      } catch (_e) {
        // ignore
      }
      unsubscribeRef.current = null;
    }

    // Check if max retries reached and we have an error
    if (retryCountRef.current >= maxRetries && subscriptionErrorRef.current) {
      console.error(
        `[${subscriptionKey}] Max retries (${maxRetries}) reached. Stopping subscription attempts.`,
        subscriptionErrorRef.current,
      );

      // Report to Sentry when max retries are reached
      try {
        Sentry.captureException(subscriptionErrorRef.current, {
          tags: {
            subscriptionKey,
            maxRetries: String(maxRetries),
            context: "useLatestWithSubscription",
          },
          extra: {
            variablesHash: variableHashRef.current,
            highestId: highestIdRef.current,
          },
        });
      } catch (sentryError) {
        console.error("Failed to report to Sentry:", sentryError);
      }

      return;
    }

    // Wait for:
    // - either initial setup not done yet
    // - or a new wsClosedDate (WS reconnect)
    // - or a retry trigger
    if (initialSetupDoneRef.current && !wsClosedDate && retryTrigger === 0) {
      return;
    }

    // Also wait until the query stops loading
    if (!initialSetupDoneRef.current && wasLoadingRef.current) return;

    // Clean up any existing timeout
    if (timeoutIdRef.current) {
      clearTimeout(timeoutIdRef.current);
      timeoutIdRef.current = null;
    }

    // Calculate backoff delay if this is a retry
    const backoffDelay =
      retryCountRef.current > 0
        ? Math.min(
            INITIAL_BACKOFF_MS * Math.pow(2, retryCountRef.current - 1),
            MAX_BACKOFF_MS,
          )
        : 0;

    const retryMessage =
      retryCountRef.current > 0
        ? ` Retry attempt ${retryCountRef.current}/${maxRetries} after ${backoffDelay}ms delay`
        : "";

    console.log(
      `[${subscriptionKey}] Setting up subscription${retryMessage} with highestId:`,
      highestIdRef.current,
    );

    // Use timeout for backoff
    timeoutIdRef.current = setTimeout(() => {
      initialSetupDoneRef.current = true;

      try {
        const unsubscribe = subscribeToMore({
          document: subscription,
          variables: {
            ...variables,
            [cursorVar]: highestIdRef.current,
          },
          context: {
            ...contextRef.current,
            subscriptionKey,
          },
          onError: (error) => {
            // Store the error
            subscriptionErrorRef.current = error;

            // Increment retry counter but don't exceed maxRetries
            retryCountRef.current = Math.min(
              retryCountRef.current + 1,
              maxRetries,
            );

            console.error(
              `[${subscriptionKey}] Subscription error (attempt ${retryCountRef.current}/${maxRetries}):`,
              error,
            );

            // If we haven't reached max retries, trigger a retry
            if (retryCountRef.current < maxRetries) {
              // Set a delay before retrying
              setTimeout(() => {
                setRetryTrigger((prev) => prev + 1);
              }, 100); // Small delay to prevent immediate re-execution
            }
          },
          updateQuery: (prev, { subscriptionData }) => {
            // Successfully received data, reset retry counter
            if (subscriptionData.data) {
              retryCountRef.current = 0;
              subscriptionErrorRef.current = null;
              lastSubscriptionDataAtRef.current = Date.now();
            }

            if (!subscriptionData.data) return prev;

            const queryRootKey = Object.keys(prev)[0];
            const subscriptionRootKey = Object.keys(subscriptionData.data)[0];
            if (!queryRootKey || !subscriptionRootKey) return prev;

            const newItems = subscriptionData.data[subscriptionRootKey] || [];
            const existingItems = prev[queryRootKey] || [];

            // Filter new items
            const filteredNewItems = newItems.filter(
              (item) =>
                shouldIncludeItemRef.current(item, contextRef.current) &&
                !existingItems.some(
                  (existing) => existing[uniqKey] === item[uniqKey],
                ),
            );

            if (filteredNewItems.length === 0) return prev;

            // Update highestId if we received any new items
            filteredNewItems.forEach((item) => {
              const itemId = item[cursorKey];
              if (itemId !== undefined && itemId > highestIdRef.current) {
                highestIdRef.current = itemId;
              }
            });

            console.log(
              `[${subscriptionKey}] Received ${filteredNewItems.length} new items, updated highestId:`,
              highestIdRef.current,
            );

            // For latest items pattern, we prepend new items (DESC order in UI)
            return {
              ...prev,
              [queryRootKey]: [...filteredNewItems, ...existingItems],
            };
          },
        });

        unsubscribeRef.current = unsubscribe;
      } catch (error) {
        // Handle setup errors (like malformed queries)
        console.error(
          `[${subscriptionKey}] Error setting up subscription:`,
          error,
        );
        subscriptionErrorRef.current = error;

        // Increment retry counter but don't exceed maxRetries
        retryCountRef.current = Math.min(retryCountRef.current + 1, maxRetries);

        console.error(
          `[${subscriptionKey}] Subscription setup error (attempt ${retryCountRef.current}/${maxRetries}):`,
          error,
        );

        // If we haven't reached max retries, trigger a retry
        if (retryCountRef.current < maxRetries) {
          setTimeout(() => {
            setRetryTrigger((prev) => prev + 1);
          }, 100);
        } else {
          // Report to Sentry when max retries are reached
          try {
            Sentry.captureException(error, {
              tags: {
                subscriptionKey,
                maxRetries: String(maxRetries),
                context: "useLatestWithSubscription-setup",
              },
              extra: {
                variablesHash: variableHashRef.current,
                highestId: highestIdRef.current,
              },
            });
          } catch (sentryError) {
            console.error("Failed to report to Sentry:", sentryError);
          }
        }
      }
    }, backoffDelay);

    // Cleanup function that will run when component unmounts or effect re-runs
    return () => {
      console.log(`[${subscriptionKey}] Cleaning up subscription`);
      if (timeoutIdRef.current) {
        clearTimeout(timeoutIdRef.current);
        timeoutIdRef.current = null;
      }
      if (unsubscribeRef.current) {
        try {
          unsubscribeRef.current();
        } catch (_e) {
          // ignore
        }
        unsubscribeRef.current = null;
      }
    };
  }, [
    skip,
    wsClosedDate,
    subscribeToMore,
    subscription,
    variables,
    cursorVar,
    uniqKey,
    cursorKey,
    subscriptionKey,
    retryTrigger,
    maxRetries,
    livenessStaleMs,
    livenessCheckEveryMs,
  ]);

  return {
    data: queryData,
    loading,
    error,
  };
}
