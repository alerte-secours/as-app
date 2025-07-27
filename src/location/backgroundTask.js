import { Platform } from "react-native";
import BackgroundGeolocation from "react-native-background-geolocation";
import { memoryAsyncStorage } from "~/storage/memoryAsyncStorage";
import { STORAGE_KEYS } from "~/storage/storageKeys";
import { createLogger } from "~/lib/logger";
import { getStoredLocation } from "./storage";
import { getAuthState } from "~/stores";
import env from "~/env";

// Constants for persistence
const FORCE_SYNC_INTERVAL = 12 * 60 * 60 * 1000;
// const FORCE_SYNC_INTERVAL = 1 * 60 * 1000; // DEBUGGING

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

const executeSyncAndroid = async () => {
  await BackgroundGeolocation.changePace(true);
  await BackgroundGeolocation.sync();
};

const executeSyncIOS = async () => {
  try {
    const locationData = await getStoredLocation();

    if (!locationData) {
      geolocBgLogger.debug("No stored location data found, skipping sync");
      return;
    }

    const { timestamp, coords } = locationData;

    // Check if timestamp is too old (> 2 weeks)
    const now = new Date();
    const locationTime = new Date(timestamp);
    const twoWeeksInMs = 14 * 24 * 60 * 60 * 1000; // 2 weeks in milliseconds

    if (now - locationTime > twoWeeksInMs) {
      geolocBgLogger.debug("Stored location is too old, skipping sync", {
        locationAge: now - locationTime,
        maxAge: twoWeeksInMs,
        timestamp: timestamp,
      });
      return;
    }

    // Get auth token
    const { userToken } = getAuthState();

    if (!userToken) {
      geolocBgLogger.debug("No auth token available, skipping sync");
      return;
    }

    // Validate coordinates
    if (
      !coords ||
      typeof coords.latitude !== "number" ||
      typeof coords.longitude !== "number"
    ) {
      geolocBgLogger.error("Invalid coordinates in stored location", {
        coords,
      });
      return;
    }

    // Prepare payload according to API spec
    const payload = {
      location: {
        event: "heartbeat",
        coords: {
          latitude: coords.latitude,
          longitude: coords.longitude,
        },
      },
    };

    geolocBgLogger.debug("Syncing location to server", {
      url: env.GEOLOC_SYNC_URL,
      coords: payload.location.coords,
    });

    // Make HTTP request
    const response = await fetch(env.GEOLOC_SYNC_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${userToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const responseData = await response.json();

    if (responseData.ok !== true) {
      throw new Error(`API returned ok: ${responseData.ok}`);
    }

    geolocBgLogger.info("iOS location sync completed successfully", {
      status: response.status,
      coords: payload.location.coords,
    });
  } catch (error) {
    geolocBgLogger.error("iOS location sync failed", {
      error: error.message,
      stack: error.stack,
    });
  }
};

// Shared heartbeat logic - mutualized between Android and iOS
const executeSync = async () => {
  if (Platform.OS === "ios") {
    await executeSyncIOS();
  } else if (Platform.OS === "android") {
    await executeSyncAndroid();
  }
};
export const executeHeartbeatSync = async () => {
  const lastSyncTime = await getLastSyncTime();
  const now = Date.now();
  const timeSinceLastSync = now - lastSyncTime;

  if (timeSinceLastSync >= FORCE_SYNC_INTERVAL) {
    geolocBgLogger.info("Forcing location sync", {
      timeSinceLastSync,
      forceInterval: FORCE_SYNC_INTERVAL,
    });

    try {
      const syncResult = await Promise.race([
        executeSync(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("changePace timeout")), 20000),
        ),
      ]);

      await setLastSyncTime(now);

      geolocBgLogger.info("Force sync completed successfully", {
        syncResult,
      });

      return syncResult;
    } catch (syncError) {
      geolocBgLogger.error("Force sync failed", {
        error: syncError.message,
        timeSinceLastSync,
      });

      return {
        syncPerformed: true,
        syncSuccessful: false,
        error: syncError.message,
      };
    }
  } else {
    geolocBgLogger.debug("Sync not needed yet", {
      timeSinceLastSync,
      forceInterval: FORCE_SYNC_INTERVAL,
      timeUntilNextSync: FORCE_SYNC_INTERVAL - timeSinceLastSync,
    });

    return {
      syncPerformed: false,
      syncSuccessful: true,
    };
  }
};
