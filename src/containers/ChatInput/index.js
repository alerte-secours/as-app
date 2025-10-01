import React, { useState, useCallback, useEffect, useRef } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import {
  useAudioRecorder,
  createAudioPlayer,
  setAudioModeAsync,
  requestRecordingPermissionsAsync,
  RecordingPresets,
  IOSOutputFormat,
  AudioQuality,
} from "expo-audio";

import Countdown from "react-countdown";

import { useAlertState, getLocationState, useSessionState } from "~/stores";
import { useTheme, createStyles } from "~/theme";
import network from "~/network";

import TextArea from "./TextArea";
import useInsertMessage from "~/hooks/useInsertMessage";

const MODE = {
  EMPTY: "EMPTY",
  RECORDING: "RECORDING",
  TEXT: "TEXT",
};

const rightButtonIconNames = {
  [MODE.EMPTY]: "microphone",
  [MODE.RECORDING]: "send-circle",
  [MODE.TEXT]: "send-circle",
};

const RECORDING_TIMEOUT = 59;

// Speech-optimized profile (smaller files, good voice quality)
const recordingOptionsSpeech = {
  ...RecordingPresets.HIGH_QUALITY,
  // Voice-friendly sample rate & bitrate
  sampleRate: 22050,
  numberOfChannels: 1,
  bitRate: 24000,
  ios: {
    ...RecordingPresets.HIGH_QUALITY.ios,
    outputFormat: IOSOutputFormat.MPEG4AAC,
    // Medium is enough for voice; final quality driven by bitRate above
    audioQuality: AudioQuality.MEDIUM,
  },
  android: {
    ...RecordingPresets.HIGH_QUALITY.android,
    outputFormat: "mpeg4",
    audioEncoder: "aac",
  },
};

// Fallback profile (broader device compatibility if speech profile fails)
const recordingOptionsFallback = {
  ...RecordingPresets.HIGH_QUALITY,
  sampleRate: 44100,
  numberOfChannels: 1,
  bitRate: 64000,
  ios: {
    ...RecordingPresets.HIGH_QUALITY.ios,
    outputFormat: IOSOutputFormat.MPEG4AAC,
    audioQuality: AudioQuality.MAX,
  },
  android: {
    ...RecordingPresets.HIGH_QUALITY.android,
    outputFormat: "mpeg4",
    audioEncoder: "aac",
  },
};

const activeOpacity = 0.7;

export default React.memo(function ChatInput({
  style,
  labelStyle,
  inputStyle,
  label,
  data: { alertId },
  scrollViewRef,
  ...props
}) {
  const { colors } = useTheme();
  const styles = useStyles();

  const [text, setText] = useState("");
  const { userId, username: sessionUsername } = useSessionState([
    "userId",
    "username",
  ]);
  const username = sessionUsername || "anonyme";

  const { hasMessages } = useAlertState(["hasMessages"]);
  const autoFocus = !hasMessages;

  const [isRecording, setIsRecording] = useState(false);
  const recorder = useAudioRecorder(recordingOptionsSpeech);
  const [player, setPlayer] = useState(null);

  const insertMessage = useInsertMessage(alertId);

  useEffect(() => {
    return player
      ? () => {
          try {
            player.remove();
          } catch (e) {}
        }
      : undefined;
  }, [player]);

  const hasText = text.length > 0;
  const mode = isRecording ? MODE.RECORDING : hasText ? MODE.TEXT : MODE.EMPTY;

  const sendTextMessage = useCallback(async () => {
    if (!text) {
      return;
    }
    const coords = getLocationState();
    const { latitude, longitude } = coords || {};
    const location =
      latitude && longitude
        ? {
            type: "Point",
            coordinates: [longitude, latitude],
          }
        : null;

    const messageText = text;
    setText("");

    try {
      await insertMessage({
        text: messageText,
        location,
        username,
        userId,
      });
    } catch (error) {
      console.error("Failed to send message:", error);
    }
  }, [insertMessage, text, setText, userId, username]);

  const startRecording = useCallback(async () => {
    try {
      console.log("Requesting permissions..");
      await requestRecordingPermissionsAsync();
      await setAudioModeAsync({
        allowsRecording: true,
        interruptionMode: "doNotMix",
        playsInSilentMode: true,
        interruptionModeAndroid: "doNotMix",
        shouldRouteThroughEarpiece: false,
        shouldPlayInBackground: true,
      });
      // stop playback
      if (player !== null) {
        try {
          player.remove();
        } catch (e) {}
        setPlayer(null);
      }

      console.log("Starting recording..");
      await setAudioModeAsync({
        allowsRecording: true,
        interruptionMode: "doNotMix",
        playsInSilentMode: true,
        interruptionModeAndroid: "doNotMix",
        shouldRouteThroughEarpiece: false,
        shouldPlayInBackground: true,
      });

      try {
        // Try speech-optimized settings first
        try {
          await recorder.prepareToRecordAsync(recordingOptionsSpeech);
        } catch (optErr) {
          console.log("Speech-optimized profile failed, falling back:", optErr);
          await recorder.prepareToRecordAsync(recordingOptionsFallback);
        }
        recorder.record();
        console.log("recording");
        setIsRecording(true);
      } catch (error) {
        console.log("error while recording:", error);
      }
      console.log("Recording started");
    } catch (err) {
      console.log("Failed to start recording", err);
    }
  }, [player, recorder]);

  const stopRecording = useCallback(async () => {
    try {
      await recorder.stop();
    } catch (_error) {
      // Do nothing -- already stopped/unloaded.
    }
    if (isRecording) {
      setIsRecording(false);
    }
  }, [recorder, isRecording]);

  const recordedToSound = useCallback(async () => {
    await setAudioModeAsync({
      allowsRecording: false,
      interruptionMode: "doNotMix",
      playsInSilentMode: true,
      interruptionModeAndroid: "doNotMix",
      shouldRouteThroughEarpiece: false,
      shouldPlayInBackground: true,
    });
    const status = recorder.getStatus();
    const url = status?.url;
    if (url) {
      const _player = createAudioPlayer(url);
      setPlayer(_player);
    }
  }, [recorder]);

  const uploadAudio = useCallback(async () => {
    const { url } = recorder.getStatus();
    const uri = url;
    if (!uri) {
      throw new Error("No recording URL available");
    }
    const fd = new FormData();
    fd.append("data[alertId]", alertId);
    fd.append("data[file]", {
      uri,
      type: "audio/mp4",
      name: "audioRecord.m4a",
    });
    await network.oaFilesKy.post("audio/upload", {
      body: fd,
    });
  }, [alertId, recorder]);

  const sendRecording = useCallback(async () => {
    await stopRecording();
    await recordedToSound();
    await uploadAudio();
  }, [stopRecording, recordedToSound, uploadAudio]);

  const deleteRecording = useCallback(async () => {
    await stopRecording();
  }, [stopRecording]);

  const triggerMicrophoneClick = useCallback(async () => {
    if (isRecording) {
      await sendRecording();
    } else {
      await startRecording();
    }
  }, [isRecording, startRecording, sendRecording]);

  const onRecordingCountDownComplete = useCallback(async () => {
    await stopRecording();
    await recordedToSound();
    await sendRecording();
  }, [sendRecording, stopRecording, recordedToSound]);

  // reset on alert change
  const dataRef = useRef(null);
  if (!dataRef.current) {
    dataRef.current = alertId;
  }
  if (dataRef.current !== alertId) {
    dataRef.current = alertId;
    if (hasText) {
      setText("");
    }
    if (mode === MODE.RECORDING) {
      deleteRecording();
    }
  }

  return (
    <View style={[styles.container, style]}>
      {mode === MODE.RECORDING && (
        <View style={styles.exponentContainer}>
          <MaterialCommunityIcons
            size={24}
            style={styles.recordingExponentIcon}
            color={colors.primary}
            name="microphone"
          />
          <Text style={styles.recordingExponentText}>
            Enregistrement audio en cours
          </Text>
        </View>
      )}
      <View>
        <View style={[styles.inputContainer, style]}>
          {(mode === MODE.TEXT || mode === MODE.EMPTY) && (
            <TextArea
              value={text}
              onChangeText={setText}
              autoFocus={autoFocus}
            />
          )}
          {mode === MODE.RECORDING && (
            <TouchableOpacity
              activeOpacity={activeOpacity}
              style={styles.deleteButton}
              onPress={deleteRecording}
            >
              <MaterialCommunityIcons
                size={38}
                style={styles.deleteIcon}
                color={colors.primary}
                name="delete-forever"
              />
            </TouchableOpacity>
          )}
          {mode === MODE.RECORDING && (
            <View style={styles.countdownContainer}>
              <Countdown
                autoStart
                date={Date.now() + RECORDING_TIMEOUT * 1000}
                intervalDelay={1000}
                onComplete={onRecordingCountDownComplete}
                renderer={({ seconds }) => (
                  <Text style={styles.countdownText}>
                    {seconds || RECORDING_TIMEOUT}
                  </Text>
                )}
              />
              <Text style={styles.countdownSubtitle}>
                Avant envoi automatique
              </Text>
            </View>
          )}
          <TouchableOpacity
            activeOpacity={activeOpacity}
            style={styles.sendButton}
            accessibilityLabel={
              hasText ? "envoyer le message" : "enregistrer un message audio"
            }
            onPress={hasText ? sendTextMessage : triggerMicrophoneClick}
          >
            <MaterialCommunityIcons
              size={38}
              style={styles.sendIcon}
              color={colors.primary}
              name={rightButtonIconNames[mode]}
            />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
});

const useStyles = createStyles(({ fontSize, wp, theme: { colors } }) => ({
  container: {
    flex: 1,
    display: "flex",
  },
  inputContainer: {
    display: "flex",
    flexDirection: "row",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: colors.outline,
    borderRadius: 4,
    backgroundColor: colors.surface,
    height: "100%",
    paddingLeft: wp(2),
    paddingRight: 0,
  },
  input: {
    flex: 1,
    color: colors.onBackground,
    fontSize: fontSize(14),
    height: "100%",
  },
  countdownContainer: {
    justifyContent: "center",
    flex: 1,
    height: "100%",
  },
  countdownText: {
    fontSize: 20,
    fontWeight: "bold",
    color: colors.grey,
    textAlign: "center",
  },
  countdownSubtitle: {
    fontSize: 14,
    textAlign: "center",
    color: colors.grey,
  },
  sendButton: {
    minWidth: 48,
    height: "100%",
    justifyContent: "center",
  },
  deleteButton: {
    minWidth: 48,
    height: "100%",
    justifyContent: "center",
  },
  sendIcon: {},
  deleteIcon: {
    color: colors.grey,
  },
  exponentContainer: {
    position: "absolute",
    top: -48,
    height: 48,
    width: "100%",
    backgroundColor: colors.surface,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  recordingExponentIcon: {
    width: 32,
    height: 32,
    fontSize: 24,
  },
  recordingExponentText: {
    height: 32,
    fontSize: 16,
  },
}));
