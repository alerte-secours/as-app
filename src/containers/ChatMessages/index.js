import React, { useCallback, useEffect, useState, useMemo } from "react";
import { View, ScrollView } from "react-native";
import { createStyles, useTheme } from "~/theme";
import { Button } from "react-native-paper";
import { AntDesign } from "@expo/vector-icons";

import { alertActions, aggregatedMessagesActions } from "~/stores";
import { getVisibleIndexes, isScrollAtBottom } from "./utils";

import MessageRow from "./MessageRow";
import MessageWelcome from "./MessageWelcome";

const ChatMessages = React.memo(function ChatMessages({
  scrollViewRef,
  messages = [],
  loading,
}) {
  const styles = useStyles();
  const { colors } = useTheme();

  const [messageLayouts, setMessageLayouts] = useState([]);
  const [layoutsReady, setLayoutsReady] = useState(false);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [lastMessageId, setLastMessageId] = useState(null);
  const [lastViewedIndex, setLastViewedIndex] = useState(messages.length - 1);

  useEffect(() => {
    alertActions.setHasMessages(messages.length > 0);
  }, [messages.length]);

  // Reset layouts when messages change
  useEffect(() => {
    setMessageLayouts([]);
    setLayoutsReady(false);
  }, [messages]);

  const scrollToBottom = useCallback(() => {
    scrollViewRef.current?.scrollToEnd({ animated: true });
  }, [scrollViewRef]);

  // Handle new messages and auto-scrolling
  useEffect(() => {
    if (messages.length === 0) return;

    const lastMessage = messages[messages.length - 1];

    // Only scroll if it's a new message and we're at the bottom
    if (lastMessage.id !== lastMessageId) {
      setLastMessageId(lastMessage.id);
      if (isAtBottom) {
        scrollToBottom();
      }
    }
  }, [messages, isAtBottom, scrollToBottom, lastMessageId]);

  const messagesLength = messages.length;

  const onScroll = useCallback(
    ({ nativeEvent }) => {
      const wasAtBottom = isAtBottom;
      const nowAtBottom = isScrollAtBottom(nativeEvent);

      setIsAtBottom(nowAtBottom);

      if (!wasAtBottom && nowAtBottom) {
        setLastViewedIndex(messages.length - 1);
        return;
      }

      if (!layoutsReady) return;

      const visibleIndexes = getVisibleIndexes(nativeEvent, messageLayouts);

      if (messagesLength === 0 || messageLayouts.length === 0) {
        return;
      }

      // Mark visible messages as read in the aggregated messages store
      // aggregatedMessagesActions.markMultipleMessagesAsRead(
      //   visibleIndexes
      //     .filter((index) => !messages[index].isRead)
      //     .map((index) => messages[index].id),
      // );

      const maxVisibleIndex = Math.max(...visibleIndexes);
      if (maxVisibleIndex > lastViewedIndex) {
        setLastViewedIndex(maxVisibleIndex);
      }
    },
    [
      messagesLength,
      messageLayouts,
      messages,
      layoutsReady,
      isAtBottom,
      lastViewedIndex,
    ],
  );

  const onContentSizeChange = useCallback(() => {
    if (isAtBottom && lastMessageId) {
      scrollToBottom();
    }
  }, [isAtBottom, scrollToBottom, lastMessageId]);

  const onMessageLayout = useCallback(
    (index, event) => {
      const { layout } = event.nativeEvent;
      setMessageLayouts((prev) => {
        const next = [...prev];
        next[index] = layout;
        if (next.filter(Boolean).length === messagesLength) {
          setLayoutsReady(true);
        }
        return next;
      });
    },
    [messagesLength],
  );

  const newMessagesCount = Math.max(0, messages.length - 1 - lastViewedIndex);
  const hasNewMessages = newMessagesCount > 0 && !isAtBottom;
  const newMessagesPlural = newMessagesCount > 1;
  const newMessagesText = hasNewMessages
    ? `${newMessagesCount} nouveau${newMessagesPlural ? "x" : ""} message${
        newMessagesPlural ? "s" : ""
      }`
    : "";

  if (loading) {
    return null;
  }

  return (
    <View style={styles.wrapper}>
      {hasNewMessages && (
        <View style={{ zIndex: 10 }}>
          <Button
            style={styles.newMessageButton}
            labelStyle={styles.newMessageButtonLabel}
            contentStyle={styles.newMessageButtonContent}
            icon={() => (
              <AntDesign name="arrowdown" size={14} color={colors.onPrimary} />
            )}
            onPress={scrollToBottom}
          >
            {newMessagesText}
          </Button>
        </View>
      )}
      <ScrollView
        onContentSizeChange={onContentSizeChange}
        onScroll={onScroll}
        scrollEventThrottle={16}
        ref={scrollViewRef}
      >
        <View style={styles.container}>
          <MessageWelcome />
          {messages.map((row, index) => {
            const sameUserAsPrevious =
              row.userId === messages[index - 1]?.userId;
            return (
              <MessageRow
                key={row.id}
                row={row}
                index={index}
                sameUserAsPrevious={sameUserAsPrevious}
                onLayout={(event) => onMessageLayout(index, event)}
              />
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
});

const useStyles = createStyles(({ wp, hp, scaleText, theme: { colors } }) => ({
  wrapper: {
    flex: 1,
  },
  container: {
    display: "flex",
    flex: 1,
    flexDirection: "column",
    width: "100%",
    paddingTop: 20,
    paddingBottom: 50,
    paddingHorizontal: 5,
  },
  newMessageButton: {
    position: "absolute",
    top: 0,
    width: "100%",
    backgroundColor: colors.blueLight,
    borderRadius: 0,
  },
  newMessageButtonContent: {
    // alignItems: "flex-start",
  },
  newMessageButtonLabel: {
    top: 0,
    marginVertical: 0,
    color: colors.surface,
  },
}));

ChatMessages.displayName = "ChatMessages";

export default ChatMessages;
