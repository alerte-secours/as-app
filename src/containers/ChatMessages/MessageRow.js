import React from "react";
import { View } from "react-native";
import { createStyles, useTheme } from "~/theme";
import Text from "~/components/Text";
import { useSessionState } from "~/stores";
import useTimeDisplay from "~/hooks/useTimeDisplay";
// import bgColorBySeed from "~/lib/style/bg-color-by-seed";
import env from "~/env";
import Avatar from "./Avatar";
import AudioPlayer from "./AudioPlayer";

import { MaterialCommunityIcons } from "@expo/vector-icons";

export default function MessageRow({
  row,
  index,
  sameUserAsPrevious,
  extraBottom,
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { userId: sessionUserId } = useSessionState(["userId"]);

  const { contentType, text, audioFileUuid, userId, createdAt, username } = row;

  const audioFileUri =
    contentType === "audio" ? `${env.MINIO_URL}/audio/${audioFileUuid}` : null;

  const isMine = userId === sessionUserId;

  const createdAtText = useTimeDisplay(createdAt);

  // const usernameColor = bgColorBySeed(username);

  return (
    <View style={styles.container}>
      <View
        style={[
          styles.bubbleContainer,
          isMine ? styles.bubbleContainerRight : styles.bubbleContainerLeft,
        ]}
      >
        {!isMine && (
          <View style={styles.userAvatar}>
            <Avatar message={row} />
          </View>
        )}
        <View
          style={[
            styles.triangle,
            isMine ? styles.triangleRight : styles.triangleLeft,
          ]}
        />
        <View
          style={[
            styles.bubble,
            isMine ? styles.bubbleMe : styles.bubbleOthers,
          ]}
        >
          {!sameUserAsPrevious && (
            <View style={styles.username}>
              <Text style={[styles.usernameText, { color: colors.primary }]}>
                {username || "anonyme"}
              </Text>
              {isMine && (
                <Text
                  style={[
                    styles.usernameText,
                    {
                      color: colors.primary,
                      textTransform: "none",
                      paddingLeft: 5,
                    },
                  ]}
                >
                  (moi)
                </Text>
              )}
            </View>
          )}
          <View style={styles.content}>
            {contentType === "text" && (
              <Text style={styles.contentText}>{text}</Text>
            )}
            {contentType === "audio" && (
              <View style={styles.contentAudio}>
                <AudioPlayer uri={audioFileUri} />
              </View>
            )}
          </View>
          <View style={styles.time}>
            <Text style={styles.timeText}>{createdAtText}</Text>
            {!row.isOptimistic && isMine && (
              <MaterialCommunityIcons
                name="check-circle-outline"
                size={16}
                style={styles.checkIcon}
              />
            )}
          </View>
          {extraBottom}
        </View>
      </View>
    </View>
  );
}

const useStyles = createStyles(({ wp, hp, scaleText, theme: { colors } }) => ({
  container: {
    flex: 1,
  },
  bubbleContainer: {
    flexDirection: "row",
    maxWidth: "100%",
    marginBottom: 5,
    paddingRight: 25,
  },
  bubbleContainerLeft: {},
  bubbleContainerRight: {
    flexDirection: "row-reverse",
  },
  bubble: {
    flexShrink: 1,
    paddingHorizontal: 5,
    backgroundColor: colors.surface,
    borderRadius: 10,
    paddingVertical: 4,
  },
  bubbleMe: {
    backgroundColor: colors.surfaceVariant,
  },
  bubbleOthers: {},
  triangle: {
    width: 0,
    height: 0,
    backgroundColor: "transparent",
    borderStyle: "solid",
    borderTopWidth: 10,
    borderBottomWidth: 10,
    marginTop: 2,
  },
  triangleLeft: {
    borderRightWidth: 20,
    borderTopColor: "transparent",
    borderBottomColor: "transparent",
    borderRightColor: colors.surface,
    marginRight: -10,
  },
  triangleRight: {
    borderLeftWidth: 20,
    borderTopColor: "transparent",
    borderBottomColor: "transparent",
    borderLeftColor: colors.surfaceVariant,
    marginLeft: -10,
  },

  username: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 4,
    paddingHorizontal: 4,
  },
  usernameText: {
    fontSize: 14,
    fontWeight: "bold",
    textTransform: "capitalize",
  },
  userAvatar: {
    paddingRight: 5,
  },
  content: {
    paddingHorizontal: 4,
  },
  contentText: {
    color: colors.onSurface,
    fontSize: 15,
  },
  contentAudio: {
    width: wp(60),
    minWidth: 200,
  },
  time: {
    alignSelf: "flex-end",
    flexDirection: "row",
  },
  timeText: {
    paddingTop: 2,
    color: colors.grey,
    fontSize: 14,
    paddingLeft: 20,
  },
  checkIcon: {
    position: "absolute",
    left: 0,
    paddingTop: 4,
    color: colors.primary,
  },
}));
