import BackgroundGeolocation from "react-native-background-geolocation";
import { createLogger } from "~/lib/logger";
import * as Sentry from "@sentry/react-native";
import { memoryAsyncStorage } from "~/storage/memoryAsyncStorage";
import { STORAGE_KEYS } from "~/storage/storageKeys";

// Constants for persistence
const FORCE_SYNC_INTERVAL = 12 * 60 * 60 * 1000;
// const FORCE_SYNC_INTERVAL = 5 * 60 * 1000; // DEBUGGING

// Helper functions for persisting sync time
const getLastSyncTime = async () => {
  try {
    const value = await memoryAsyncStorage.getItem(
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

// Shared heartbeat logic - mutualized between Android and iOS
export const executeHeartbeatSync = async () => {
  const taskStartTime = Date.now();
  let syncPerformed = false;
  let syncSuccessful = false;

  try {
    geolocBgLogger.info("Executing heartbeat sync");

    // Get persisted last sync time
    const lastSyncTime = await getLastSyncTime();
    const now = Date.now();
    const timeSinceLastSync = now - lastSyncTime;

    // Get current position with performance tracking
    const location = await getCurrentPosition();

    geolocBgLogger.debug("getCurrentPosition result", { location });

    // if (timeSinceLastSync >= FORCE_SYNC_INTERVAL) {
    if (true) {
      geolocBgLogger.info("Forcing location sync");
      syncPerformed = true;

      try {
        // Change pace to ensure location updates with timeout
        await Promise.race([
          BackgroundGeolocation.changePace(true),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("changePace timeout")), 10000),
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
        syncSuccessful = true;
      } catch (syncError) {
        syncSuccessful = false;

        Sentry.captureException(syncError, {
          tags: {
            module: "headless-task",
            operation: "force-sync",
            eventName: "heartbeat",
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

    const taskDuration = Date.now() - taskStartTime;
    geolocBgLogger.debug("Heartbeat sync completed", {
      duration: taskDuration,
      syncPerformed,
      syncSuccessful,
    });

    // Return result information for BackgroundFetch
    return {
      syncPerformed,
      syncSuccessful,
      duration: taskDuration,
    };
  } catch (error) {
    const taskDuration = Date.now() - taskStartTime;

    Sentry.captureException(error, {
      tags: {
        module: "headless-task",
        operation: "heartbeat-sync",
      },
      extra: {
        duration: taskDuration,
      },
    });

    geolocBgLogger.error("Heartbeat sync error", {
      error,
      duration: taskDuration,
    });

    // Return error result for BackgroundFetch
    return {
      syncPerformed,
      syncSuccessful: false,
      duration: taskDuration,
      error: error.message,
    };
  }
};
