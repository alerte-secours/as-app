import BackgroundGeolocation from "react-native-background-geolocation";
import { TRACK_MOVE } from "~/misc/devicePrefs";
import { createLogger } from "~/lib/logger";
import { BACKGROUND_SCOPES } from "~/lib/logger/scopes";
import jwtDecode from "jwt-decode";
import { initEmulatorMode } from "./emulatorService";

import { getAuthState, subscribeAuthState, permissionsActions } from "~/stores";

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
  heartbeatInterval: 900,
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

  // Log the geolocation sync URL for debugging
  locationLogger.info("Geolocation sync URL configuration", {
    url: env.GEOLOC_SYNC_URL,
    isStaging: env.IS_STAGING,
  });

  // Handle auth function - no throttling or cooldown
  async function handleAuth(userToken) {
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
      url: env.GEOLOC_SYNC_URL, // Update the sync URL for when it's changed for staging
      headers: {
        Authorization: `Bearer ${userToken}`,
      },
    });

    // Log the authorization header that was set
    locationLogger.debug(
      "Set Authorization header for background geolocation",
      {
        headerSet: true,
        tokenPrefix: userToken ? userToken.substring(0, 10) + "..." : null,
      },
    );

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

  BackgroundGeolocation.onLocation(async (location) => {
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

  BackgroundGeolocation.onHttp(async (response) => {
    // log status code and response
    locationLogger.debug("HTTP response received", {
      status: response?.status,
      responseText: response?.responseText,
    });
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
  const { userToken } = getAuthState();
  locationLogger.debug("Setting up auth state subscription");
  subscribeAuthState(({ userToken }) => userToken, handleAuth);
  locationLogger.debug("Performing initial auth handling");
  handleAuth(userToken);
  // Initialize emulator mode if previously enabled
  initEmulatorMode();
}
