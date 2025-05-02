import BackgroundGeolocation from "react-native-background-geolocation";
import { TRACK_MOVE } from "~/misc/devicePrefs";
import { createLogger } from "~/lib/logger";
import { BACKGROUND_SCOPES } from "~/lib/logger/scopes";
import jwtDecode from "jwt-decode";

import {
  getAuthState,
  subscribeAuthState,
  authActions,
  permissionsActions,
} from "~/stores";

import setLocationState from "~/location/setLocationState";
import { storeLocation } from "~/utils/location/storage";

import env from "~/env";

const config = {
  // https://github.com/transistorsoft/react-native-background-geolocation/wiki/Android-Headless-Mode
  enableHeadless: true,
  disableProviderChangeRecord: true,
  // disableMotionActivityUpdates: true,
  desiredAccuracy: BackgroundGeolocation.DESIRED_ACCURACY_HIGH,
  distanceFilter: TRACK_MOVE,
  // debug: true, // Enable debug mode for more detailed logs
  logLevel: BackgroundGeolocation.LOG_LEVEL_VERBOSE,
  // Disable automatic permission requests
  locationAuthorizationRequest: "Always",
  stopOnTerminate: false,
  startOnBoot: true,
  // Force the plugin to start aggressively
  foregroundService: true,
  notification: {
    title: "Alerte Secours",
    text: "Suivi de localisation actif",
    channelName: "Location tracking",
    priority: BackgroundGeolocation.NOTIFICATION_PRIORITY_HIGH,
  },
  backgroundPermissionRationale: {
    title:
      "Autoriser Alerte-Secours à accéder à la localisation en arrière-plan",
    message:
      "Alerte-Secours nécessite la localisation en arrière-plan pour vous alerter en temps réel lorsqu'une personne à proximité a besoin d'aide urgente. Cette fonction est essentielle pour permettre une intervention rapide et efficace en cas d'urgence.",
    positiveAction: "Autoriser",
    negativeAction: "Désactiver",
  },
  // Enhanced HTTP configuration
  url: env.GEOLOC_SYNC_URL,
  method: "POST", // Explicitly set HTTP method
  httpRootProperty: "location", // Specify the root property for the locations array
  // Configure persistence
  maxRecordsToPersist: 1, // Limit the number of records to store
  maxDaysToPersist: 7, // Limit the age of records to persist
  batchSync: false,
  autoSync: true,
  reset: true,
};
const defaultConfig = config;

export default async function trackLocation() {
  const locationLogger = createLogger({
    module: BACKGROUND_SCOPES.GEOLOCATION,
    feature: "tracking",
  });

  // Track the last time we handled auth changes to prevent rapid successive calls
  let lastAuthHandleTime = 0;
  const AUTH_HANDLE_COOLDOWN = 3000; // 3 seconds cooldown

  // Track the last time we triggered an auth reload to prevent rapid successive calls
  let lastAuthReloadTime = 0;
  const AUTH_RELOAD_COOLDOWN = 5000; // 5 seconds cooldown

  async function handleAuth(userToken) {
    // Implement debouncing for auth state changes
    const now = Date.now();
    const timeSinceLastHandle = now - lastAuthHandleTime;

    if (timeSinceLastHandle < AUTH_HANDLE_COOLDOWN) {
      locationLogger.info(
        "Auth state change handled too recently, debouncing",
        {
          timeSinceLastHandle,
          cooldown: AUTH_HANDLE_COOLDOWN,
        },
      );
      return;
    }

    lastAuthHandleTime = now;
    locationLogger.info("Handling auth token update", {
      hasToken: !!userToken,
    });
    if (!userToken) {
      locationLogger.info("No auth token, stopping location tracking");
      await BackgroundGeolocation.stop();
      locationLogger.debug("Location tracking stopped");
      return;
    }
    // unsub();
    locationLogger.debug("Updating background geolocation config");
    await BackgroundGeolocation.setConfig({
      headers: {
        Authorization: `Bearer ${userToken}`,
      },
    });
    const state = await BackgroundGeolocation.getState();
    try {
      const decodedToken = jwtDecode(userToken);
      locationLogger.debug("Decoded JWT token", { decodedToken });
    } catch (error) {
      locationLogger.error("Failed to decode JWT token", {
        error: error.message,
      });
    }

    if (state.enabled) {
      locationLogger.info("Syncing location data");
      try {
        await BackgroundGeolocation.changePace(true);
        await BackgroundGeolocation.sync();
        locationLogger.debug("Sync initiated successfully");
      } catch (error) {
        locationLogger.error("Failed to sync location data", {
          error: error.message,
          stack: error.stack,
        });
      }
    } else {
      locationLogger.info("Starting location tracking");
      try {
        await BackgroundGeolocation.start();
        locationLogger.debug("Location tracking started successfully");
      } catch (error) {
        locationLogger.error("Failed to start location tracking", {
          error: error.message,
          stack: error.stack,
        });
      }
    }
  }

  BackgroundGeolocation.onLocation((location) => {
    locationLogger.debug("Location update received", {
      coords: location.coords,
      timestamp: location.timestamp,
      activity: location.activity,
      battery: location.battery,
    });
    if (
      location.coords &&
      location.coords.latitude &&
      location.coords.longitude
    ) {
      setLocationState(location.coords);
      // Also store in AsyncStorage for last known location fallback
      storeLocation(location.coords, location.timestamp);
    }
  });

  BackgroundGeolocation.onHttp((response) => {
    locationLogger.debug("HTTP response received", {
      status: response?.status,
      success: response?.success,
      responseText: response?.responseText,
      url: response?.url,
      method: response?.method,
      isSync: response?.isSync,
    });

    const statusCode = response?.status;
    const now = Date.now();
    const timeSinceLastReload = now - lastAuthReloadTime;

    switch (statusCode) {
      case 410:
        // Token expired, logout
        locationLogger.info("Auth token expired (410), logging out");
        authActions.logout();
        break;
      case 401:
        // Unauthorized, check cooldown before triggering reload
        if (timeSinceLastReload < AUTH_RELOAD_COOLDOWN) {
          locationLogger.info("Auth reload requested too soon, skipping", {
            timeSinceLastReload,
            cooldown: AUTH_RELOAD_COOLDOWN,
          });
          return;
        }

        locationLogger.info("Refreshing authentication token");
        lastAuthReloadTime = now;
        authActions.reload(); // should retriger sync in handleAuth via subscribeAuthState when done
        break;
    }
  });

  try {
    locationLogger.info("Initializing background geolocation");
    await BackgroundGeolocation.ready(defaultConfig);
    await BackgroundGeolocation.setConfig(config);

    // Only set the permission state if we already have the permission
    const state = await BackgroundGeolocation.getState();
    locationLogger.debug("Background geolocation state", {
      enabled: state.enabled,
      trackingMode: state.trackingMode,
      isMoving: state.isMoving,
      schedulerEnabled: state.schedulerEnabled,
    });

    if (state.enabled) {
      locationLogger.info("Background location permission confirmed");
      permissionsActions.setLocationBackground(true);
    } else {
      locationLogger.warn(
        "Background location not enabled in geolocation state",
      );
    }

    // if (LOCAL_DEV) {
    //   // fixing issue on android emulator (which doesn't have accelerometer or gyroscope) by manually enabling location updates
    //   setInterval(
    //     () => {
    //       BackgroundGeolocation.changePace(true);
    //     },
    //     30 * 60 * 1000,
    //   );
    // }
  } catch (error) {
    locationLogger.error("Location tracking initialization failed", {
      error: error.message,
      stack: error.stack,
      code: error.code,
    });
  }

  // Add a function to check for pending records
  async function checkPendingRecords() {
    try {
      const count = await BackgroundGeolocation.getCount();
      locationLogger.debug("Pending location records", { count });

      if (count > 0) {
        locationLogger.info(`Found ${count} pending records, forcing sync`);
        try {
          const records = await BackgroundGeolocation.sync();
          locationLogger.debug("Forced sync result", {
            recordsCount: records?.length || 0,
          });
        } catch (error) {
          locationLogger.error("Forced sync failed", {
            error: error,
            stack: error.stack,
          });
        }
      }
    } catch (error) {
      locationLogger.error("Failed to get pending records count", {
        error: error.message,
      });
    }
  }

  const { userToken } = getAuthState();
  locationLogger.debug("Setting up auth state subscription");
  subscribeAuthState(({ userToken }) => userToken, handleAuth);
  locationLogger.debug("Performing initial auth handling");
  handleAuth(userToken);

  // Check for pending records after a short delay to ensure everything is initialized
  setTimeout(checkPendingRecords, 5000);
}
