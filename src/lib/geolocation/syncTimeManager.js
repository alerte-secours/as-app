import { memoryAsyncStorage } from "~/lib/memoryAsyncStorage";
import { createLogger } from "~/lib/logger";
import { BACKGROUND_SCOPES } from "~/lib/logger/scopes";
import * as Sentry from "@sentry/react-native";

// Constants for persistence
const LAST_SYNC_TIME_KEY = "@geolocation_last_sync_time";

// Create logger for sync time management
const syncTimeLogger = createLogger({
  module: BACKGROUND_SCOPES.GEOLOCATION,
  feature: "sync-time",
});

/**
 * Get the last sync time from storage
 * @returns {Promise<number>} The last sync time in milliseconds, or current time if not found
 */
export const getLastSyncTime = async () => {
  try {
    const value = await memoryAsyncStorage.getItem(LAST_SYNC_TIME_KEY);
    const lastSyncTime = value ? parseInt(value, 10) : Date.now();

    syncTimeLogger.debug("Retrieved last sync time", {
      value,
      lastSyncTime,
      isDefault: !value,
    });

    return lastSyncTime;
  } catch (error) {
    syncTimeLogger.error("Failed to get last sync time", {
      error: error.message,
    });

    Sentry.captureException(error, {
      tags: { module: "sync-time-manager", operation: "get-last-sync-time" },
    });

    // Return current time as fallback
    return Date.now();
  }
};

/**
 * Set the last sync time in storage
 * @param {number} time - The sync time in milliseconds
 */
export const setLastSyncTime = async (time) => {
  try {
    await memoryAsyncStorage.setItem(LAST_SYNC_TIME_KEY, time.toString());

    syncTimeLogger.debug("Set last sync time", {
      time,
      timeISO: new Date(time).toISOString(),
    });
  } catch (error) {
    syncTimeLogger.error("Failed to set last sync time", {
      error: error.message,
      time,
    });

    Sentry.captureException(error, {
      tags: { module: "sync-time-manager", operation: "set-last-sync-time" },
    });
  }
};
