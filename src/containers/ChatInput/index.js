import React, { useState, useCallback, useEffect, useRef } from "react";
import { View, Text, TouchableOpacity, Platform, Alert } from "react-native";
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

import {
  check,
  request,
  PERMISSIONS,
  RESULTS,
  openSettings,
} from "react-native-permissions";

import Countdown from "react-countdown";

import { useAlertState, getLocationState, useSessionState } from "~/stores";
import { useTheme, createStyles } from "~/theme";
import network from "~/network";

import TextArea from "./TextArea";
import useInsertMessage from "~/hooks/useInsertMessage";
import { announceForA11y } from "~/lib/a11y";

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

const withTimeout = (promise, ms = 10000) =>
  new Promise((resolve, reject) => {
    const id = setTimeout(
      () => reject(new Error("Permission request timeout")),
      ms,
    );
    promise
      .then((v) => {
        clearTimeout(id);
        resolve(v);
      })
      .catch((e) => {
        clearTimeout(id);
        reject(e);
      });
  });

const ensureMicPermission = async () => {
  if (Platform.OS !== "android") {
    return { granted: true, status: RESULTS.UNAVAILABLE };
  }
  try {
    const status = await check(PERMISSIONS.ANDROID.RECORD_AUDIO);
    switch (status) {
      case RESULTS.GRANTED:
        return { granted: true, status };
      case RESULTS.DENIED: {
        const r = await request(PERMISSIONS.ANDROID.RECORD_AUDIO);
        return { granted: r === RESULTS.GRANTED, status: r };
      }
      case RESULTS.BLOCKED:
        return { granted: false, status };
      // NOTE: RESULTS.LIMITED is not applicable to RECORD_AUDIO; treat as not granted.
      case RESULTS.UNAVAILABLE:
      case RESULTS.LIMITED:
      default:
        return { granted: false, status };
    }
  } catch (e) {
    console.log("Mic permission check failed", e);
    return { granted: false, status: undefined };
  }
};

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
  const textInputRef = useRef(null);
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
  const requestingMicRef = useRef(false);

  // A11y: avoid repeated announcements while recording (e.g. every countdown tick)
  const lastRecordingAnnouncementRef = useRef(null);

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

      // Keep focus stable for SR users: after sending, restore focus to the input.
      // (Do not move focus elsewhere; let the user continue typing.)
      setTimeout(() => {
        textInputRef.current?.focus?.();
      }, 0);
    } catch (error) {
      console.error("Failed to send message:", error);
      announceForA11y("Échec de l'envoi du message");
    }
  }, [insertMessage, text, setText, userId, username]);

  const startRecording = useCallback(async () => {
    if (requestingMicRef.current) {
      return;
    }
    requestingMicRef.current = true;
    try {
      console.log("Requesting microphone permission..");
      if (Platform.OS === "android") {
        const { granted, status } = await ensureMicPermission();
        if (!granted) {
          if (status === RESULTS.BLOCKED) {
            try {
              Alert.alert(
                "Autorisation micro bloquée",
                "Veuillez autoriser le micro dans les paramètres de l'application.",
                [
                  { text: "Annuler", style: "cancel" },
                  { text: "Ouvrir les paramètres", onPress: openSettings },
                ],
              );
            } catch (_) {}
          } else {
            console.log("Microphone permission not granted", status);
          }
          return;
        }
      } else {
        try {
          await withTimeout(requestRecordingPermissionsAsync(), 10000);
        } catch (permErr) {
          console.log(
            "Microphone permission request failed/timed out:",
            permErr,
          );
          return;
        }
      }
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

        // Announce once when recording starts.
        if (lastRecordingAnnouncementRef.current !== "started") {
          lastRecordingAnnouncementRef.current = "started";
          announceForA11y("Enregistrement démarré");
        }
      } catch (error) {
        console.log("error while recording:", error);
      }
      console.log("Recording started");
    } catch (err) {
      console.log("Failed to start recording", err);
    } finally {
      requestingMicRef.current = false;
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

      // Announce once when recording stops.
      if (lastRecordingAnnouncementRef.current !== "stopped") {
        lastRecordingAnnouncementRef.current = "stopped";
        announceForA11y("Enregistrement arrêté");
      }
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
    try {
      await stopRecording();
      await recordedToSound();
      await uploadAudio();

      // Keep focus stable: return focus to input after finishing recording flow.
      setTimeout(() => {
        textInputRef.current?.focus?.();
      }, 0);
    } catch (error) {
      console.error("Failed to send recording:", error);
      announceForA11y("Échec de l'envoi de l'enregistrement audio");
    }
  }, [stopRecording, recordedToSound, uploadAudio]);

  const deleteRecording = useCallback(async () => {
    await stopRecording();
    setTimeout(() => {
      textInputRef.current?.focus?.();
    }, 0);
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
              inputRef={textInputRef}
            />
          )}
          {mode === MODE.RECORDING && (
            <TouchableOpacity
              testID="chat-input-delete-recording"
              accessibilityRole="button"
              accessibilityLabel="Supprimer l'enregistrement"
              accessibilityHint="Supprime l'enregistrement audio. Action destructive."
              accessibilityState={{ disabled: false }}
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
            <View
              style={styles.countdownContainer}
              accessible
              accessibilityRole="text"
              accessibilityLabel="Compte à rebours avant envoi automatique"
              accessibilityHint="Affiche le temps restant avant l'envoi automatique."
            >
              <Countdown
                autoStart
                date={Date.now() + RECORDING_TIMEOUT * 1000}
                intervalDelay={1000}
                onComplete={onRecordingCountDownComplete}
                renderer={({ seconds }) => (
                  <Text
                    style={styles.countdownText}
                    accessible={false}
                    importantForAccessibility="no"
                  >
                    {seconds || RECORDING_TIMEOUT}
                  </Text>
                )}
              />
              <Text
                style={styles.countdownSubtitle}
                accessible={false}
                importantForAccessibility="no"
              >
                Avant envoi automatique
              </Text>
            </View>
          )}
          <TouchableOpacity
            testID={hasText ? "chat-input-send" : "chat-input-mic"}
            activeOpacity={activeOpacity}
            style={styles.sendButton}
            accessibilityRole="button"
            accessibilityLabel={
              hasText
                ? "Envoyer le message"
                : isRecording
                ? "Envoyer l'enregistrement audio"
                : "Démarrer l'enregistrement audio"
            }
            accessibilityHint={
              hasText
                ? "Envoie le message."
                : isRecording
                ? "Envoie l'enregistrement audio."
                : "Démarre l'enregistrement audio."
            }
            accessibilityState={{
              disabled: false,
              ...(isRecording ? { selected: true } : null),
            }}
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
