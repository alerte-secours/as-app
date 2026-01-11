import BackgroundGeolocation from "react-native-background-geolocation";
import { TRACK_MOVE } from "~/misc/devicePrefs";
import { createLogger } from "~/lib/logger";
import { BACKGROUND_SCOPES } from "~/lib/logger/scopes";
import jwtDecode from "jwt-decode";
import { initEmulatorMode } from "./emulatorService";

import {
  getAlertState,
  getAuthState,
  getSessionState,
  subscribeAlertState,
  subscribeAuthState,
  subscribeSessionState,
  permissionsActions,
} from "~/stores";

import setLocationState from "~/location/setLocationState";
import { storeLocation } from "~/location/storage";

import env from "~/env";

// Common config: keep always-on tracking enabled, but default to an IDLE low-power profile.
// High-accuracy and "moving" mode are only enabled when an active alert is open.
const baseConfig = {
  // https://github.com/transistorsoft/react-native-background-geolocation/wiki/Android-Headless-Mode
  enableHeadless: true,
  disableProviderChangeRecord: true,
  // disableMotionActivityUpdates: true,
  // Default to low-power (idle) profile; will be overridden when needed.
  desiredAccuracy: BackgroundGeolocation.DESIRED_ACCURACY_LOW,
  // Larger distance filter in idle mode to prevent frequent GPS wakes.
  distanceFilter: 200,
  // debug: true, // Enable debug mode for more detailed logs
  logLevel: BackgroundGeolocation.LOG_LEVEL_VERBOSE,
  // Disable automatic permission requests
  locationAuthorizationRequest: "Always",
  stopOnTerminate: false,
  startOnBoot: true,
  // Keep heartbeat very infrequent in idle mode.
  heartbeatInterval: 3600,
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

const TRACKING_PROFILES = {
  idle: {
    desiredAccuracy: BackgroundGeolocation.DESIRED_ACCURACY_LOW,
    distanceFilter: 200,
    heartbeatInterval: 3600,
  },
  active: {
    desiredAccuracy: BackgroundGeolocation.DESIRED_ACCURACY_HIGH,
    distanceFilter: TRACK_MOVE,
    heartbeatInterval: 900,
  },
};

export default async function trackLocation() {
  const locationLogger = createLogger({
    module: BACKGROUND_SCOPES.GEOLOCATION,
    feature: "tracking",
  });

  let currentProfile = null;
  let authReady = false;
  let stopAlertSubscription = null;
  let stopSessionSubscription = null;

  const computeHasOwnOpenAlert = () => {
    try {
      const { userId } = getSessionState();
      const { alertingList } = getAlertState();
      if (!userId || !Array.isArray(alertingList)) return false;
      return alertingList.some(
        ({ oneAlert }) =>
          oneAlert?.state === "open" && oneAlert?.userId === userId,
      );
    } catch (e) {
      locationLogger.warn("Failed to compute active-alert state", {
        error: e?.message,
      });
      return false;
    }
  };

  const applyProfile = async (profileName) => {
    if (!authReady) {
      // We only apply profile once auth headers are configured.
      return;
    }
    if (currentProfile === profileName) return;

    const profile = TRACKING_PROFILES[profileName];
    if (!profile) {
      locationLogger.warn("Unknown tracking profile", { profileName });
      return;
    }

    locationLogger.info("Applying tracking profile", {
      profileName,
      desiredAccuracy: profile.desiredAccuracy,
      distanceFilter: profile.distanceFilter,
      heartbeatInterval: profile.heartbeatInterval,
    });

    try {
      await BackgroundGeolocation.setConfig(profile);

      // Key battery fix:
      // - IDLE profile forces stationary mode
      // - ACTIVE profile forces moving mode
      await BackgroundGeolocation.changePace(profileName === "active");

      currentProfile = profileName;
    } catch (error) {
      locationLogger.error("Failed to apply tracking profile", {
        profileName,
        error: error?.message,
        stack: error?.stack,
      });
    }
  };

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

      // Cleanup subscriptions when logged out.
      try {
        stopAlertSubscription && stopAlertSubscription();
        stopSessionSubscription && stopSessionSubscription();
      } finally {
        stopAlertSubscription = null;
        stopSessionSubscription = null;
      }

      authReady = false;
      currentProfile = null;
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

    authReady = true;

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

    if (!state.enabled) {
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

    // Ensure we are NOT forcing "moving" mode by default.
    // Default profile is idle unless an active alert requires higher accuracy.
    const shouldBeActive = computeHasOwnOpenAlert();
    await applyProfile(shouldBeActive ? "active" : "idle");

    // Subscribe to changes that may require switching profiles.
    if (!stopSessionSubscription) {
      stopSessionSubscription = subscribeSessionState(
        (s) => s?.userId,
        () => {
          const active = computeHasOwnOpenAlert();
          applyProfile(active ? "active" : "idle");
        },
      );
    }
    if (!stopAlertSubscription) {
      stopAlertSubscription = subscribeAlertState(
        (s) => s?.alertingList,
        () => {
          const active = computeHasOwnOpenAlert();
          applyProfile(active ? "active" : "idle");
        },
      );
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
    await BackgroundGeolocation.ready(baseConfig);
    await BackgroundGeolocation.setConfig(baseConfig);

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

  // Initialize emulator mode only in dev/staging to avoid accidental production battery drain.
  if (__DEV__ || env.IS_STAGING) {
    initEmulatorMode();
  }
}
