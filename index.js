// debug
import "./wdyr"; // <--- first import
import "./warnFilter";

import "expo-splash-screen";
import BackgroundGeolocation from "react-native-background-geolocation";

import notifee from "@notifee/react-native";
import messaging from "@react-native-firebase/messaging";

import "~/sentry";

import { registerRootComponent } from "expo";

import App from "~/app";

import { onBackgroundEvent as notificationBackgroundEvent } from "~/notifications/onEvent";
import onMessageReceived from "~/notifications/onMessageReceived";

import { createLogger } from "~/lib/logger";
import * as Sentry from "@sentry/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { STORAGE_KEYS } from "~/storage/storageKeys";

// setup notification, this have to stay in index.js
notifee.onBackgroundEvent(notificationBackgroundEvent);
messaging().setBackgroundMessageHandler(onMessageReceived);

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

// Constants for persistence
const FORCE_SYNC_INTERVAL = 12 * 60 * 60 * 1000;
// const FORCE_SYNC_INTERVAL = 5 * 60 * 1000; // DEBUGGING

// Helper functions for persisting sync time
const getLastSyncTime = async () => {
  try {
    const value = await AsyncStorage.getItem(
      STORAGE_KEYS.GEOLOCATION_LAST_SYNC_TIME,
    );
    return value ? parseInt(value, 10) : Date.now();
  } catch (error) {
    Sentry.captureException(error, {
      tags: { module: "headless-task", operation: "get-last-sync-time" },
    });
    return Date.now();
  }
};

const setLastSyncTime = async (time) => {
  try {
    await AsyncStorage.setItem(
      STORAGE_KEYS.GEOLOCATION_LAST_SYNC_TIME,
      time.toString(),
    );
  } catch (error) {
    Sentry.captureException(error, {
      tags: { module: "headless-task", operation: "set-last-sync-time" },
    });
  }
};

// this have to stay in index.js, see also https://github.com/transistorsoft/react-native-background-geolocation/wiki/Android-Headless-Mode
const getCurrentPosition = () => {
  return new Promise((resolve) => {
    // Add timeout protection
    const timeout = setTimeout(() => {
      resolve({ code: -1, message: "getCurrentPosition timeout" });
    }, 15000); // 15 second timeout

    BackgroundGeolocation.getCurrentPosition(
      {
        samples: 1,
        persist: true,
        extras: { background: true },
        timeout: 10, // 10 second timeout in the plugin itself
      },
      (location) => {
        clearTimeout(timeout);
        resolve(location);
      },
      (error) => {
        clearTimeout(timeout);
        resolve(error);
      },
    );
  });
};

const geolocBgLogger = createLogger({
  service: "background-geolocation",
  task: "headless",
});

const HeadlessTask = async (event) => {
  // Add timeout protection for the entire headless task
  const taskTimeout = setTimeout(() => {
    geolocBgLogger.error("HeadlessTask timeout", { event });

    Sentry.captureException(new Error("HeadlessTask timeout"), {
      tags: {
        module: "background-geolocation",
        operation: "headless-task-timeout",
        eventName: event?.name,
      },
    });
  }, 60000); // 60 second timeout

  // Simple performance tracking without deprecated APIs
  const taskStartTime = Date.now();

  try {
    // Validate event structure
    if (!event || typeof event !== "object") {
      throw new Error("Invalid event object received");
    }

    const { name, params } = event;

    if (!name || typeof name !== "string") {
      throw new Error("Invalid event name received");
    }

    geolocBgLogger.info("HeadlessTask event received", { name, params });

    switch (name) {
      case "heartbeat":
        // Get persisted last sync time
        const lastSyncTime = await getLastSyncTime();
        const now = Date.now();
        const timeSinceLastSync = now - lastSyncTime;

        // Get current position with performance tracking
        const location = await getCurrentPosition();

        geolocBgLogger.debug("getCurrentPosition result", { location });

        if (timeSinceLastSync >= FORCE_SYNC_INTERVAL) {
          geolocBgLogger.info("Forcing location sync after 24h");

          try {
            // Change pace to ensure location updates with timeout
            await Promise.race([
              BackgroundGeolocation.changePace(true),
              new Promise((_, reject) =>
                setTimeout(
                  () => reject(new Error("changePace timeout")),
                  10000,
                ),
              ),
            ]);

            // Perform sync with timeout
            const syncResult = await Promise.race([
              BackgroundGeolocation.sync(),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error("sync timeout")), 20000),
              ),
            ]);

            // Update last sync time after successful sync
            await setLastSyncTime(now);
          } catch (syncError) {
            Sentry.captureException(syncError, {
              tags: {
                module: "headless-task",
                operation: "force-sync",
                eventName: name,
              },
              contexts: {
                syncAttempt: {
                  timeSinceLastSync: timeSinceLastSync,
                  lastSyncTime: new Date(lastSyncTime).toISOString(),
                },
              },
            });

            geolocBgLogger.error("Force sync failed", { error: syncError });
          }
        }
        break;

      case "location":
        // Validate location parameters
        if (!params || typeof params !== "object") {
          geolocBgLogger.warn("Invalid location params", { params });
          break;
        }

        geolocBgLogger.debug("Location update received", {
          location: params.location,
        });
        break;

      case "http":
        // Validate HTTP parameters
        if (!params || typeof params !== "object" || !params.response) {
          geolocBgLogger.warn("Invalid HTTP params", { params });
          break;
        }

        const httpStatus = params.response?.status;
        const isHttpSuccess = httpStatus === 200;

        geolocBgLogger.debug("HTTP response received", {
          response: params.response,
        });

        // Update last sync time on successful HTTP response
        if (isHttpSuccess) {
          try {
            const now = Date.now();
            await setLastSyncTime(now);
          } catch (syncTimeError) {
            geolocBgLogger.error("Failed to update sync time", {
              error: syncTimeError,
            });

            Sentry.captureException(syncTimeError, {
              tags: {
                module: "headless-task",
                operation: "update-sync-time-http",
              },
            });
          }
        }
        break;

      default:
        break;
    }

    // Task completed successfully
    const taskDuration = Date.now() - taskStartTime;
  } catch (error) {
    const taskDuration = Date.now() - taskStartTime;

    // Capture any unexpected errors
    Sentry.captureException(error, {
      tags: {
        module: "headless-task",
        eventName: event?.name || "unknown",
      },
      extra: {
        duration: taskDuration,
      },
    });

    geolocBgLogger.error("HeadlessTask error", {
      error,
      event,
      duration: taskDuration,
    });
  } finally {
    // Clear the timeout
    clearTimeout(taskTimeout);

    const finalDuration = Date.now() - taskStartTime;
    geolocBgLogger.debug("HeadlessTask completed", {
      event: event?.name,
      duration: finalDuration,
    });
  }
};

BackgroundGeolocation.registerHeadlessTask(HeadlessTask);
