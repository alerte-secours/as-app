import { useCallback, useEffect, useRef, useState } from "react";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  setIsAudioActiveAsync,
  useAudioRecorder,
} from "expo-audio";

let hasLoggedAudioMode = false;

export default function useVoiceRecorder() {
  const recorderRef = useRef(null);
  const [isRecording, setIsRecording] = useState(false);
  const [uri, setUri] = useState(null);

  // NOTE: `expo-audio` doesn't export `AudioRecorder` as a runtime JS class.
  // The supported API is `useAudioRecorder`, which returns a native-backed SharedObject.
  const preset =
    RecordingPresets?.HIGH_QUALITY || RecordingPresets?.LOW_QUALITY;
  if (!preset) {
    throw new Error(
      "expo-audio RecordingPresets are not available; cannot start recording",
    );
  }
  const recorder = useAudioRecorder({
    ...preset,
    isMeteringEnabled: true,
  });

  useEffect(() => {
    recorderRef.current = recorder;
    return () => {
      if (recorderRef.current === recorder) {
        recorderRef.current = null;
      }
    };
  }, [recorder]);

  const cleanupRecording = useCallback(async () => {
    const recorder = recorderRef.current;
    if (recorder) {
      try {
        if (recorder.isRecording) {
          await recorder.stop();
        }
      } catch (_e) {
        // no-op
      }
    }
    setIsRecording(false);
  }, []);

  const start = useCallback(async () => {
    // Reset any previous recording before starting a new one
    await cleanupRecording();
    setUri(null);

    const permission = await requestRecordingPermissionsAsync();
    if (!permission?.granted) {
      throw new Error("Microphone permission not granted");
    }

    // Configure audio mode for recording (iOS & Android)
    const recordingAudioMode = {
      allowsRecording: true,
      playsInSilentMode: true,
      interruptionMode: "doNotMix",
      interruptionModeAndroid: "doNotMix",
      shouldRouteThroughEarpiece: false,
      // Foreground-first: keep the audio session inactive in background.
      shouldPlayInBackground: false,
    };

    if (!hasLoggedAudioMode) {
      console.log("[useVoiceRecorder] audio mode set", recordingAudioMode);
      hasLoggedAudioMode = true;
    }

    await setAudioModeAsync(recordingAudioMode);

    const prepareAndStart = async () => {
      await setIsAudioActiveAsync(true).catch(() => {});
      console.log("[useVoiceRecorder] preparing recorder");
      await recorder.prepareToRecordAsync();
      console.log("[useVoiceRecorder] starting recorder");
      recorder.record();
      setIsRecording(true);
    };
    try {
      await prepareAndStart();
    } catch (error) {
      console.log("[useVoiceRecorder] recorder start failed", error);

      // One controlled retry for iOS: reset the audio session and try once more.
      try {
        await cleanupRecording();
        await setAudioModeAsync(recordingAudioMode);
        await new Promise((r) => setTimeout(r, 150));
        await prepareAndStart();
        return;
      } catch (_retryError) {
        console.log("[useVoiceRecorder] recorder retry failed", _retryError);
      }

      try {
        if (recorderRef.current?.isRecording) {
          await recorderRef.current.stop();
        }
      } catch (_e) {
        // ignore cleanup failures
      } finally {
        // keep recorder instance; hook will manage its lifecycle
        setIsRecording(false);
      }
      throw error;
    }
  }, [cleanupRecording, recorder]);

  const stop = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder) {
      setIsRecording(false);
      return null;
    }

    try {
      await recorder.stop();
    } catch (_e) {
      // ignore errors from already-stopped/unloaded recordings
    }

    const recordingUri = recorder.uri;
    setUri(recordingUri ?? null);
    setIsRecording(false);
    return recordingUri ?? null;
  }, []);

  const reset = useCallback(() => {
    setUri(null);
    setIsRecording(false);
  }, []);

  useEffect(() => {
    return () => {
      const recorder = recorderRef.current;
      if (recorder) {
        if (recorder.isRecording) {
          recorder.stop().catch(() => {});
        }
      }
    };
  }, []);

  return {
    isRecording,
    uri,
    start,
    stop,
    reset,
  };
}
