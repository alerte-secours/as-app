import BackgroundGeolocation from "react-native-background-geolocation";
import { memoryAsyncStorage } from "~/storage/memoryAsyncStorage";
import { STORAGE_KEYS } from "~/storage/storageKeys";
import { createLogger } from "~/lib/logger";

// Constants for persistence
const FORCE_SYNC_INTERVAL = 12 * 60 * 60 * 1000;
// const FORCE_SYNC_INTERVAL = 5 * 60 * 1000; // DEBUGGING

const geolocBgLogger = createLogger({
  service: "background-task",
  task: "headless",
});

// Helper functions for persisting sync time
const getLastSyncTime = async () => {
  try {
    const value = await memoryAsyncStorage.getItem(
      STORAGE_KEYS.GEOLOCATION_LAST_SYNC_TIME,
    );
    return value ? parseInt(value, 10) : Date.now();
  } catch (error) {
    return 0;
  }
};

const setLastSyncTime = async (time) => {
  try {
    await memoryAsyncStorage.setItem(
      STORAGE_KEYS.GEOLOCATION_LAST_SYNC_TIME,
      time.toString(),
    );
  } catch (error) {
    // silent error
  }
};

// Shared heartbeat logic - mutualized between Android and iOS
const executeSync = async () => {
  let syncPerformed = false;
  let syncSuccessful = false;

  try {
    syncPerformed = true;

    try {
      // Change pace to ensure location updates
      await BackgroundGeolocation.changePace(true);

      // Perform sync
      await BackgroundGeolocation.sync();

      syncSuccessful = true;
    } catch (syncError) {
      syncSuccessful = false;
    }

    // Return result information for BackgroundFetch
    return {
      syncPerformed,
      syncSuccessful,
    };
  } catch (error) {
    // Return error result for BackgroundFetch
    return {
      syncPerformed,
      syncSuccessful: false,
      error: error.message,
    };
  }
};
export const executeHeartbeatSync = async () => {
  const lastSyncTime = await getLastSyncTime();
  const now = Date.now();
  const timeSinceLastSync = now - lastSyncTime;
  if (timeSinceLastSync >= FORCE_SYNC_INTERVAL) {
    geolocBgLogger.info("Forcing location sync");
    try {
      await Promise.race([
        async () => {
          await executeSync();
        },
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("changePace timeout")), 10000),
        ),
      ]);

      await setLastSyncTime(now);
    } catch (syncError) {
      geolocBgLogger.error("Force sync failed", { error: syncError });
    }
  }
};
