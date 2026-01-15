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

export default function useStreamQueryWithSubscription(
  initialQuery,
  subscription,
  {
    cursorVar = "cursor",
    cursorKey = "id",
    uniqKey = "id",
    variables: paramVariables = {},
    initialCursor = -1,
    skip = false,
    subscriptionKey = "default",
    context = DEFAULT_CONTEXT,
    shouldIncludeItem = DEFAULT_SHOULD_INCLUDE_ITEM,
    maxRetries = MAX_RETRIES, // Allow overriding default max retries
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
  const lastCursorRef = useRef(initialCursor);
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

  // Per-subscription liveness watchdog: if WS is connected but this subscription
  // hasn't delivered any payload for some time, trigger a resubscribe.
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
      // Avoid spamming resubscribe triggers.
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
        `[${subscriptionKey}] Variables changed, resetting cursor to initial value:`,
        initialCursor,
      );
      lastCursorRef.current = initialCursor;
      variableHashRef.current = currentVarsHash;
      initialSetupDoneRef.current = false;
      wasLoadingRef.current = true;
    }
  }, [variables, initialCursor, cursorVar, subscriptionKey]);

  const queryVariables = useMemo(
    () => ({
      ...variables,
      [cursorVar]: initialCursor,
    }),
    [variables, cursorVar, initialCursor],
  );

  const {
    data: queryData,
    loading,
    error,
    subscribeToMore,
  } = useQuery(initialQuery, {
    ...queryParams,
    variables: queryVariables,
    fetchPolicy: queryParams.fetchPolicy || "cache-and-network",
    skip,
    context: {
      ...context,
      subscriptionKey,
    },
    onCompleted: (data) => {
      // (Optional) Place for further logic if needed
      // console.log(`[${subscriptionKey}] initial query onCompleted`, data);
    },
  });

  // Update last cursor from the main query results
  useEffect(() => {
    if (!queryData) return;

    const queryRootKey = Object.keys(queryData)[0];
    if (!queryRootKey) return;

    const items = queryData[queryRootKey] || [];
    // We only consider non-optimistic items
    const nonOptimisticItems = items.filter((item) => !item.isOptimistic);

    if (nonOptimisticItems.length > 0) {
      const lastItem = nonOptimisticItems[nonOptimisticItems.length - 1];
      const newCursor = lastItem[cursorKey];

      lastCursorRef.current = newCursor;
      console.log(
        `[${subscriptionKey}] Updated subscription cursor:`,
        newCursor,
      );
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

    // If we're about to (re)subscribe, always cleanup any previous subscription first.
    // This is critical because React effect cleanups must be returned synchronously
    // from the effect, not from inside async callbacks.
    if (unsubscribeRef.current) {
      try {
        unsubscribeRef.current();
      } catch (_e) {
        // ignore
      }
      unsubscribeRef.current = null;
    }

    // Check if max retries reached and we have an error - this check must be done regardless of other conditions
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
            context: "useStreamQueryWithSubscription",
          },
          extra: {
            variablesHash: variableHashRef.current,
            lastCursor: lastCursorRef.current,
          },
        });
      } catch (sentryError) {
        console.error("Failed to report to Sentry:", sentryError);
      }

      return;
    }

    // Wait for:
    //  - either initial setup not done yet
    //  - or a new wsClosedDate (WS reconnect)
    //  - or a retry trigger
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
      `[${subscriptionKey}] Setting up subscription${retryMessage} with cursor:`,
      lastCursorRef.current,
    );

    // Use timeout for backoff
    timeoutIdRef.current = setTimeout(() => {
      initialSetupDoneRef.current = true;

      try {
        const unsubscribe = subscribeToMore({
          document: subscription,
          variables: {
            ...variables,
            [cursorVar]: lastCursorRef.current,
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

            // 1) Build a map from existing items
            const itemMap = new Map();
            existingItems.forEach((item) => {
              // If the user's filter says "include," we add it
              if (shouldIncludeItemRef.current(item, contextRef.current)) {
                itemMap.set(item[uniqKey], item);
              }
            });

            // 2) Merge new items
            newItems.forEach((item) => {
              if (!shouldIncludeItemRef.current(item, contextRef.current)) {
                return;
              }

              // Update last cursor if item is newer
              const newItemCursor = item[cursorKey];
              if (
                !lastCursorRef.current ||
                newItemCursor > lastCursorRef.current
              ) {
                lastCursorRef.current = newItemCursor;
                console.log(
                  `[${subscriptionKey}] New message received with cursor:`,
                  lastCursorRef.current,
                );
              }

              const existing = itemMap.get(item[uniqKey]);
              // If there's no item yet, or the existing was optimistic while this is not, replace
              if (!existing || (existing.isOptimistic && !item.isOptimistic)) {
                itemMap.set(item[uniqKey], item);
              }
            });

            // 3) Sort by cursorKey
            const sortedItems = Array.from(itemMap.values()).sort((a, b) => {
              const aCursor = a[cursorKey];
              const bCursor = b[cursorKey];
              return aCursor - bCursor;
            });

            return {
              [queryRootKey]: sortedItems,
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
                context: "useStreamQueryWithSubscription-setup",
              },
              extra: {
                variablesHash: variableHashRef.current,
                lastCursor: lastCursorRef.current,
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
