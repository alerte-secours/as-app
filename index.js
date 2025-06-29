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

// setup notification, this have to stay in index.js
notifee.onBackgroundEvent(notificationBackgroundEvent);
messaging().setBackgroundMessageHandler(onMessageReceived);

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

// Constants for persistence
const LAST_SYNC_TIME_KEY = "@geolocation_last_sync_time";
// const FORCE_SYNC_INTERVAL = 24 * 60 * 60 * 1000;
const FORCE_SYNC_INTERVAL = 60 * 60 * 1000; // DEBUGGING

// Helper functions for persisting sync time
const getLastSyncTime = async () => {
  try {
    const value = await AsyncStorage.getItem(LAST_SYNC_TIME_KEY);
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
    await AsyncStorage.setItem(LAST_SYNC_TIME_KEY, time.toString());
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

    // Add initial breadcrumb
    Sentry.addBreadcrumb({
      message: "HeadlessTask started",
      category: "headless-task",
      level: "info",
      data: {
        eventName: name,
        params: params ? JSON.stringify(params) : null,
        timestamp: Date.now(),
      },
    });

    geolocBgLogger.info("HeadlessTask event received", { name, params });

    switch (name) {
      case "heartbeat":
        // Add breadcrumb for heartbeat event
        Sentry.addBreadcrumb({
          message: "Heartbeat event received",
          category: "headless-task",
          level: "info",
          timestamp: Date.now() / 1000,
        });

        // Get persisted last sync time
        const lastSyncTime = await getLastSyncTime();
        const now = Date.now();
        const timeSinceLastSync = now - lastSyncTime;

        // Add context about sync timing
        Sentry.setContext("sync-timing", {
          lastSyncTime: new Date(lastSyncTime).toISOString(),
          currentTime: new Date(now).toISOString(),
          timeSinceLastSync: timeSinceLastSync,
          timeSinceLastSyncHours: (
            timeSinceLastSync /
            (1000 * 60 * 60)
          ).toFixed(2),
          needsForceSync: timeSinceLastSync >= FORCE_SYNC_INTERVAL,
        });

        Sentry.addBreadcrumb({
          message: "Sync timing calculated",
          category: "headless-task",
          level: "info",
          data: {
            timeSinceLastSyncHours: (
              timeSinceLastSync /
              (1000 * 60 * 60)
            ).toFixed(2),
            needsForceSync: timeSinceLastSync >= FORCE_SYNC_INTERVAL,
          },
        });

        // Get current position with performance tracking
        const locationStartTime = Date.now();
        const location = await getCurrentPosition();
        const locationDuration = Date.now() - locationStartTime;

        const isLocationError = location && location.code !== undefined;

        Sentry.addBreadcrumb({
          message: "getCurrentPosition completed",
          category: "headless-task",
          level: isLocationError ? "warning" : "info",
          data: {
            success: !isLocationError,
            error: isLocationError ? location : undefined,
            coords: !isLocationError ? location?.coords : undefined,
          },
        });

        geolocBgLogger.debug("getCurrentPosition result", { location });

        if (timeSinceLastSync >= FORCE_SYNC_INTERVAL) {
          geolocBgLogger.info("Forcing location sync after 24h");

          Sentry.addBreadcrumb({
            message: "Force sync triggered",
            category: "headless-task",
            level: "info",
            data: {
              timeSinceLastSyncHours: (
                timeSinceLastSync /
                (1000 * 60 * 60)
              ).toFixed(2),
            },
          });

          try {
            // Get pending records count before sync with timeout
            const pendingCount = await Promise.race([
              BackgroundGeolocation.getCount(),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error("getCount timeout")), 10000),
              ),
            ]);

            Sentry.addBreadcrumb({
              message: "Pending records count",
              category: "headless-task",
              level: "info",
              data: { pendingCount },
            });

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

            Sentry.addBreadcrumb({
              message: "changePace completed",
              category: "headless-task",
              level: "info",
            });

            // Perform sync with timeout
            const syncResult = await Promise.race([
              BackgroundGeolocation.sync(),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error("sync timeout")), 20000),
              ),
            ]);

            Sentry.addBreadcrumb({
              message: "Sync completed successfully",
              category: "headless-task",
              level: "info",
              data: {
                syncResult: Array.isArray(syncResult)
                  ? `${syncResult.length} records`
                  : "completed",
              },
            });

            // Update last sync time after successful sync
            await setLastSyncTime(now);

            Sentry.addBreadcrumb({
              message: "Last sync time updated",
              category: "headless-task",
              level: "info",
              data: { newSyncTime: new Date(now).toISOString() },
            });
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
        } else {
          Sentry.addBreadcrumb({
            message: "Force sync not needed",
            category: "headless-task",
            level: "info",
            data: {
              timeSinceLastSyncHours: (
                timeSinceLastSync /
                (1000 * 60 * 60)
              ).toFixed(2),
              nextSyncInHours: (
                (FORCE_SYNC_INTERVAL - timeSinceLastSync) /
                (1000 * 60 * 60)
              ).toFixed(2),
            },
          });
        }
        break;

      case "location":
        // Validate location parameters
        if (!params || typeof params !== "object") {
          geolocBgLogger.warn("Invalid location params", { params });
          break;
        }

        Sentry.addBreadcrumb({
          message: "Location update received",
          category: "headless-task",
          level: "info",
          data: {
            coords: params.location?.coords,
            activity: params.location?.activity,
            hasLocation: !!params.location,
          },
        });

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

        Sentry.addBreadcrumb({
          message: "HTTP response received",
          category: "headless-task",
          level: isHttpSuccess ? "info" : "warning",
          data: {
            status: httpStatus,
            success: params.response?.success,
            hasResponse: !!params.response,
          },
        });

        geolocBgLogger.debug("HTTP response received", {
          response: params.response,
        });

        // Update last sync time on successful HTTP response
        if (isHttpSuccess) {
          try {
            const now = Date.now();
            await setLastSyncTime(now);

            Sentry.addBreadcrumb({
              message: "Last sync time updated (HTTP success)",
              category: "headless-task",
              level: "info",
              data: { newSyncTime: new Date(now).toISOString() },
            });
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
        Sentry.addBreadcrumb({
          message: "Unknown event type",
          category: "headless-task",
          level: "warning",
          data: { eventName: name },
        });
    }

    // Task completed successfully
    const taskDuration = Date.now() - taskStartTime;

    Sentry.addBreadcrumb({
      message: "HeadlessTask completed successfully",
      category: "headless-task",
      level: "info",
      data: {
        eventName: name,
        duration: taskDuration,
      },
    });
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
