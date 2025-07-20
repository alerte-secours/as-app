// debug
import "./wdyr"; // <--- first import
import "./warnFilter";

import "expo-splash-screen";
import { Platform } from "react-native";
import BackgroundGeolocation from "react-native-background-geolocation";
import BackgroundFetch from "react-native-background-fetch";

import notifee from "@notifee/react-native";
import messaging from "@react-native-firebase/messaging";

import "~/sentry";

import { registerRootComponent } from "expo";

import App from "~/app";

import { onBackgroundEvent as notificationBackgroundEvent } from "~/notifications/onEvent";
import onMessageReceived from "~/notifications/onMessageReceived";

import { executeHeartbeatSync } from "~/location/backgroundTask";
import { createLogger } from "~/lib/logger";
import * as Sentry from "@sentry/react-native";
import { memoryAsyncStorage } from "~/storage/memoryAsyncStorage";
import { STORAGE_KEYS } from "~/storage/storageKeys";

// setup notification, this have to stay in index.js
notifee.onBackgroundEvent(notificationBackgroundEvent);
messaging().setBackgroundMessageHandler(onMessageReceived);

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

const geolocBgLogger = createLogger({
  service: "background-geolocation",
  task: "headless",
});

// Helper functions for persisting sync time (needed for HTTP event handling)
const setLastSyncTime = async (time) => {
  try {
    await memoryAsyncStorage.setItem(
      STORAGE_KEYS.GEOLOCATION_LAST_SYNC_TIME,
      time.toString(),
    );
  } catch (error) {
    Sentry.captureException(error, {
      tags: { module: "headless-task", operation: "set-last-sync-time" },
    });
  }
};

// Android: Full BackgroundGeolocation headless task handler
const androidHeadlessTask = async (event) => {
  // Add timeout protection for the entire headless task
  const taskTimeout = setTimeout(() => {
    geolocBgLogger.error("Android HeadlessTask timeout", { event });

    Sentry.captureException(new Error("Android HeadlessTask timeout"), {
      tags: {
        module: "background-geolocation",
        operation: "android-headless-task-timeout",
        eventName: event?.name,
      },
    });
  }, 60000); // 60 second timeout

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

    geolocBgLogger.info("Android HeadlessTask event received", {
      name,
      params,
    });

    switch (name) {
      case "heartbeat":
        // Use the shared heartbeat logic
        await executeHeartbeatSync();
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
        geolocBgLogger.debug("Unknown event type", { name });
        break;
    }

    const taskDuration = Date.now() - taskStartTime;
    geolocBgLogger.debug("Android HeadlessTask completed", {
      event: name,
      duration: taskDuration,
    });
  } catch (error) {
    const taskDuration = Date.now() - taskStartTime;

    // Capture any unexpected errors
    Sentry.captureException(error, {
      tags: {
        module: "headless-task",
        platform: "android",
        eventName: event?.name || "unknown",
      },
      extra: {
        duration: taskDuration,
      },
    });

    geolocBgLogger.error("Android HeadlessTask error", {
      error,
      event,
      duration: taskDuration,
    });
  } finally {
    // Clear the timeout
    clearTimeout(taskTimeout);
  }
};

// iOS: Simple BackgroundFetch headless task handler
const iosBackgroundFetchTask = async (event) => {
  const taskId = event?.taskId;

  // Add timeout protection for the entire headless task
  const taskTimeout = setTimeout(() => {
    geolocBgLogger.error("iOS BackgroundFetch timeout", { event });

    Sentry.captureException(new Error("iOS BackgroundFetch timeout"), {
      tags: {
        module: "background-fetch",
        operation: "ios-background-fetch-timeout",
        taskId,
      },
    });

    // Force finish the task to prevent native side hanging
    try {
      if (taskId) {
        BackgroundFetch.finish(taskId);
        geolocBgLogger.debug(
          "iOS BackgroundFetch task force-finished due to timeout",
          { taskId },
        );
      }
    } catch (finishError) {
      geolocBgLogger.error(
        "CRITICAL: Failed to force-finish timed out iOS BackgroundFetch task",
        {
          taskId,
          error: finishError,
        },
      );

      Sentry.captureException(finishError, {
        tags: {
          module: "background-fetch",
          operation: "ios-background-fetch-timeout-finish",
          critical: true,
        },
        contexts: {
          task: { taskId },
        },
      });
    }
  }, 30000); // 30 second timeout (shorter for BackgroundFetch)

  const taskStartTime = Date.now();

  try {
    if (!taskId) {
      throw new Error("No taskId provided in iOS BackgroundFetch event");
    }

    geolocBgLogger.info("iOS BackgroundFetch task started", {
      taskId,
    });

    // Just execute the shared heartbeat logic
    await executeHeartbeatSync();

    const taskDuration = Date.now() - taskStartTime;
    geolocBgLogger.debug("iOS BackgroundFetch task completed", {
      taskId,
      duration: taskDuration,
    });
  } catch (error) {
    const taskDuration = Date.now() - taskStartTime;

    // Capture any unexpected errors
    Sentry.captureException(error, {
      tags: {
        module: "background-fetch",
        platform: "ios",
        taskId: taskId || "unknown",
      },
      extra: {
        duration: taskDuration,
      },
    });

    geolocBgLogger.error("iOS BackgroundFetch task error", {
      error,
      event,
      duration: taskDuration,
    });
  } finally {
    // Clear the timeout
    clearTimeout(taskTimeout);

    // CRITICAL: Always call finish, even on error
    try {
      if (taskId) {
        BackgroundFetch.finish(taskId);
        geolocBgLogger.debug("iOS BackgroundFetch task finished", { taskId });
      } else {
        geolocBgLogger.error(
          "Cannot finish iOS BackgroundFetch task - no taskId",
          { event },
        );
      }
    } catch (finishError) {
      // This is a critical error - the native side might be in a bad state
      geolocBgLogger.error(
        "CRITICAL: BackgroundFetch.finish() failed in iOS task",
        {
          taskId,
          error: finishError,
          event,
        },
      );

      Sentry.captureException(finishError, {
        tags: {
          module: "background-fetch",
          operation: "ios-background-fetch-finish",
          critical: true,
        },
        contexts: {
          task: { taskId },
          event: { eventData: JSON.stringify(event) },
        },
      });
    }
  }
};

// Platform-specific background task registration
// BackgroundGeolocation.registerHeadlessTask only works on Android
// For iOS, we must rely on BackgroundFetch
if (Platform.OS === "android") {
  // Android: Use BackgroundGeolocation headless task with full event handling
  // BackgroundGeolocation already provides comprehensive background task handling for Android
  BackgroundGeolocation.registerHeadlessTask(androidHeadlessTask);
} else if (Platform.OS === "ios") {
  // iOS: Use BackgroundFetch with both headless task and configure callback
  // - registerHeadlessTask: handles when app is completely terminated
  // - configure callback: handles when app is backgrounded but still running
  // Both are needed to work in all situations
  BackgroundFetch.registerHeadlessTask(iosBackgroundFetchTask);

  // Configure BackgroundFetch for iOS (iOS-specific configuration)
  BackgroundFetch.configure(
    {
      minimumFetchInterval: 15, // Only valid option for iOS - gives best chance of execution
      // Note: stopOnTerminate, startOnBoot, forceAlarmManager are Android-only and don't work on iOS
    },
    // Event callback
    async (taskId) => {
      geolocBgLogger.info("iOS BackgroundFetch configure task started", {
        taskId,
      });

      try {
        await executeHeartbeatSync();
        geolocBgLogger.info(
          "iOS BackgroundFetch configure task completed successfully",
          {
            taskId,
          },
        );
      } catch (error) {
        geolocBgLogger.error("iOS BackgroundFetch configure task failed", {
          taskId,
          error,
        });

        Sentry.captureException(error, {
          tags: {
            module: "background-fetch",
            operation: "ios-background-fetch-configure-task",
            taskId,
          },
        });
      } finally {
        // CRITICAL: Always call finish, even on error
        try {
          if (taskId) {
            BackgroundFetch.finish(taskId);
            geolocBgLogger.debug(
              "iOS BackgroundFetch configure task finished",
              { taskId },
            );
          } else {
            geolocBgLogger.error(
              "Cannot finish iOS BackgroundFetch configure task - no taskId",
            );
          }
        } catch (finishError) {
          // This is a critical error - the native side might be in a bad state
          geolocBgLogger.error(
            "CRITICAL: BackgroundFetch.finish() failed in configure task",
            {
              taskId,
              error: finishError,
            },
          );

          Sentry.captureException(finishError, {
            tags: {
              module: "background-fetch",
              operation: "ios-background-fetch-configure-finish",
              critical: true,
            },
            contexts: {
              task: { taskId },
            },
          });
        }
      }
    },
    // Timeout callback (REQUIRED by BackgroundFetch API)
    async (taskId) => {
      geolocBgLogger.warn("iOS BackgroundFetch configure task TIMEOUT", {
        taskId,
      });

      Sentry.captureException(
        new Error("iOS BackgroundFetch configure task timeout"),
        {
          tags: {
            module: "background-fetch",
            operation: "ios-background-fetch-configure-timeout",
            taskId,
          },
        },
      );

      // CRITICAL: Must call finish on timeout
      BackgroundFetch.finish(taskId);
    },
  ).catch((error) => {
    geolocBgLogger.error("iOS BackgroundFetch failed to configure", {
      error,
    });

    Sentry.captureException(error, {
      tags: {
        module: "background-fetch",
        operation: "ios-background-fetch-configure",
      },
    });
  });
}
