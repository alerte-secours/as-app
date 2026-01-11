import { useRef, useEffect, useMemo, useState } from "react";
import { useQuery } from "@apollo/client";
import * as Sentry from "@sentry/react-native";
import { useNetworkState } from "~/stores";
import { createLogger } from "~/lib/logger";
import { UI_SCOPES } from "~/lib/logger/scopes";
import useShallowMemo from "./useShallowMemo";

const hookLogger = createLogger({
  module: UI_SCOPES.HOOKS,
  feature: "useLatestWithSubscription",
});

// Constants for retry configuration
const MAX_RETRIES = 5;
const INITIAL_BACKOFF_MS = 1000; // 1 second
const MAX_BACKOFF_MS = 30000; // 30 seconds

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
    context = {},
    shouldIncludeItem = () => true,
    maxRetries = MAX_RETRIES,
    ...queryParams
  } = {},
) {
  const variables = useShallowMemo(() => paramVariables, paramVariables);

  const { wsClosedDate } = useNetworkState(["wsClosedDate"]);

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
  const lastWsClosedDateRef = useRef(null);

  useEffect(() => {
    const currentVarsHash = JSON.stringify(variables);
    if (currentVarsHash !== variableHashRef.current) {
      hookLogger.debug("Variables changed; resetting subscription setup", {
        subscriptionKey,
      });
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
        hookLogger.debug("Updated subscription cursor to highest ID", {
          subscriptionKey,
          highestId,
        });
      }
    } else {
      // Handle empty results case - initialize with 0 to allow subscription for first item
      if (highestIdRef.current === null) {
        highestIdRef.current = 0;
        hookLogger.debug("No initial items; setting subscription cursor", {
          subscriptionKey,
          highestId: 0,
        });
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

    // Track WS close events so we only react when wsClosedDate actually changes
    const wsClosedDateChanged =
      !!wsClosedDate && wsClosedDate !== lastWsClosedDateRef.current;
    if (wsClosedDateChanged) {
      lastWsClosedDateRef.current = wsClosedDate;
    }

    // Check if max retries reached and we have an error
    if (retryCountRef.current >= maxRetries && subscriptionErrorRef.current) {
      hookLogger.error("Max retries reached; stopping subscription attempts", {
        subscriptionKey,
        maxRetries,
        error: subscriptionErrorRef.current,
      });

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
        hookLogger.error("Failed to report max-retries to Sentry", {
          subscriptionKey,
          error: sentryError,
        });
      }

      return;
    }

    // Wait for:
    // - initial setup not done yet
    // - OR a new wsClosedDate (WS reconnect)
    // - OR a retry trigger
    if (
      initialSetupDoneRef.current &&
      !wsClosedDateChanged &&
      retryTrigger === 0
    ) {
      return;
    }

    // Also wait until the query stops loading
    if (!initialSetupDoneRef.current && wasLoadingRef.current) return;

    // Clean up any existing timeout
    if (timeoutIdRef.current) {
      clearTimeout(timeoutIdRef.current);
      timeoutIdRef.current = null;
    }

    // Always cleanup any existing subscription before creating a new one
    if (unsubscribeRef.current) {
      try {
        unsubscribeRef.current();
      } catch (_error) {
        // ignore
      }
      unsubscribeRef.current = null;
    }

    // Calculate backoff delay if this is a retry
    const backoffDelay =
      retryCountRef.current > 0
        ? Math.min(
            INITIAL_BACKOFF_MS * Math.pow(2, retryCountRef.current - 1),
            MAX_BACKOFF_MS,
          )
        : 0;

    hookLogger.debug("Setting up subscription", {
      subscriptionKey,
      retryCount: retryCountRef.current,
      maxRetries,
      backoffDelay,
      highestId: highestIdRef.current,
    });

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
            ...context,
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

            hookLogger.warn("Subscription error", {
              subscriptionKey,
              attempt: retryCountRef.current,
              maxRetries,
              error,
            });

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
                shouldIncludeItem(item, context) &&
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

            hookLogger.debug("Received new items", {
              subscriptionKey,
              receivedCount: filteredNewItems.length,
              highestId: highestIdRef.current,
            });

            // For latest items pattern, we prepend new items (DESC order in UI)
            return {
              ...prev,
              [queryRootKey]: [...filteredNewItems, ...existingItems],
            };
          },
        });

        // Save unsubscribe for cleanup on reruns/unmount
        unsubscribeRef.current = unsubscribe;

        // Note: cleanup is handled by the effect cleanup below.
      } catch (error) {
        // Handle setup errors (like malformed queries)
        hookLogger.error("Error setting up subscription", {
          subscriptionKey,
          error,
        });
        subscriptionErrorRef.current = error;

        // Increment retry counter but don't exceed maxRetries
        retryCountRef.current = Math.min(retryCountRef.current + 1, maxRetries);

        hookLogger.warn("Subscription setup error", {
          subscriptionKey,
          attempt: retryCountRef.current,
          maxRetries,
          error,
        });

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
            hookLogger.error("Failed to report setup error to Sentry", {
              subscriptionKey,
              error: sentryError,
            });
          }
        }

        // Cleanup is handled by the effect cleanup below.
      }
    }, backoffDelay);

    // Cleanup function that will run when component unmounts or effect re-runs
    return () => {
      if (timeoutIdRef.current) {
        clearTimeout(timeoutIdRef.current);
        timeoutIdRef.current = null;
      }

      if (unsubscribeRef.current) {
        try {
          hookLogger.debug("Cleaning up subscription", { subscriptionKey });
          unsubscribeRef.current();
        } catch (_error) {
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
    context,
    shouldIncludeItem,
    retryTrigger,
    maxRetries,
  ]);

  return {
    data: queryData,
    loading,
    error,
  };
}
