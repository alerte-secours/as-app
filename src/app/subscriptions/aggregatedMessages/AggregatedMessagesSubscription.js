import React, { useEffect, useRef } from "react";
import useStreamQueryWithSubscription from "~/hooks/useStreamQueryWithSubscription";
import { aggregatedMessagesActions } from "~/stores";
import { createLogger } from "~/lib/logger";
import { FEATURE_SCOPES, NETWORK_SCOPES } from "~/lib/logger/scopes";

import {
  AGGREGATED_MESSAGES_QUERY,
  AGGREGATED_MESSAGES_SUBSCRIPTION,
} from "./gql";

const messagesLogger = createLogger({
  module: FEATURE_SCOPES.CHAT,
  feature: NETWORK_SCOPES.GRAPHQL,
});

const AggregatedMessagesSubscription = () => {
  // Ref to track if we've already run the cleanup
  const initRunRef = useRef(false);

  // Aggregated messages subscription
  const {
    data: messagesData,
    error: messagesError,
    loading,
  } = useStreamQueryWithSubscription(
    AGGREGATED_MESSAGES_QUERY,
    AGGREGATED_MESSAGES_SUBSCRIPTION,
    {
      cursorVar: "cursor",
      cursorKey: "id",
      uniqKey: "id",
      initialCursor: -1,
      subscriptionKey: "aggregated-messages",
      fetchPolicy: "network-only",
      nextFetchPolicy: "cache-first",
      // Chat is latency-sensitive; if the WS transport is up but this subscription
      // delivers nothing for a while, force a resubscribe.
      livenessStaleMs: 60_000,

      // If WS reconnects, refetch base query once before resubscribing to reduce cursor gaps.
      refetchOnReconnect: true,
    },
  );

  // Update loading state
  useEffect(() => {
    aggregatedMessagesActions.setLoading(loading);
  }, [loading]);

  // Effect for messages data
  useEffect(() => {
    if (!messagesData) {
      return;
    }

    if (messagesData.selectManyMessage) {
      const messagesList = messagesData.selectManyMessage;
      aggregatedMessagesActions.debouncedUpdateMessagesList(messagesList);
      if (!initRunRef.current) {
        initRunRef.current = true;
        aggregatedMessagesActions.init(messagesList);
      }
    }
  }, [messagesData]);

  if (messagesError) {
    messagesLogger.error("Aggregated messages subscription error", {
      error: messagesError.message,
      stack: messagesError.stack,
    });
    aggregatedMessagesActions.setError(messagesError);
  }

  return null;
};

export default AggregatedMessagesSubscription;
