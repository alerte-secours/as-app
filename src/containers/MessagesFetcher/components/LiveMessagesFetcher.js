import React, { useEffect, useMemo, useRef } from "react";
import { useIsFocused } from "@react-navigation/native";
import { useQuery } from "@apollo/client";
import * as Sentry from "@sentry/react-native";
import ChatMessages from "~/containers/ChatMessages";
import {
  useAggregatedMessagesState,
  aggregatedMessagesActions,
} from "~/stores";

import { SELECT_MANY_MESSAGE_QUERY } from "../gql";

const LiveMessagesFetcher = ({ scrollViewRef, alertId }) => {
  // Get messages from aggregated messages store
  const {
    messagesList,
    loading: storeLoading,
    error: storeError,
  } = useAggregatedMessagesState(
    (state) => {
      const { messagesList: fullMessageList, loading, error } = state;
      const messagesList = fullMessageList.filter(
        (message) => message.alertId === alertId,
      );
      return {
        messagesList,
        loading,
        error,
      };
    },
    [alertId],
  );

  const isFocused = useIsFocused();

  // Fallback: when focused on a chat, periodically refetch messages for this alert.
  // This helps recover faster if the global aggregated subscription is delayed/stale.
  const lastSeenCountRef = useRef(0);
  const lastChangeAtRef = useRef(Date.now());

  const { refetch } = useQuery(SELECT_MANY_MESSAGE_QUERY, {
    variables: { alertId },
    skip: !isFocused || !alertId,
    fetchPolicy: "network-only",
    nextFetchPolicy: "cache-first",
    notifyOnNetworkStatusChange: false,
  });

  useEffect(() => {
    if (!isFocused) return;
    const count = messagesList?.length ?? 0;
    if (count !== lastSeenCountRef.current) {
      lastSeenCountRef.current = count;
      lastChangeAtRef.current = Date.now();
    }
  }, [isFocused, messagesList]);

  useEffect(() => {
    if (!isFocused) return;
    if (!alertId) return;

    const CHECK_EVERY_MS = 15_000;
    const STALE_MS = 45_000;

    const interval = setInterval(() => {
      const age = Date.now() - lastChangeAtRef.current;
      if (age < STALE_MS) return;

      try {
        Sentry.addBreadcrumb({
          category: "chat",
          level: "warning",
          message: "chat fallback refetch (stale)",
          data: { alertId, ageMs: age },
        });
      } catch (_e) {
        // ignore
      }

      refetch?.().catch((e) => {
        try {
          Sentry.captureException(e, {
            tags: { context: "chat-fallback-refetch" },
            extra: { alertId, ageMs: age },
          });
        } catch (_e2) {
          // ignore
        }
      });
    }, CHECK_EVERY_MS);

    return () => clearInterval(interval);
  }, [alertId, isFocused, refetch]);

  useEffect(() => {
    if (!isFocused || !messagesList) {
      return;
    }
    aggregatedMessagesActions.markMultipleMessagesAsRead(
      messagesList
        .filter((message) => !message.isRead)
        .map((message) => message.id),
    );
  }, [alertId, isFocused, messagesList]);

  return (
    <ChatMessages
      scrollViewRef={scrollViewRef}
      messages={messagesList || []}
      loading={storeLoading}
    />
  );
};

export default LiveMessagesFetcher;
