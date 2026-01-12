import BackgroundGeolocation from "react-native-background-geolocation";
import { TRACK_MOVE } from "~/misc/devicePrefs";
import env from "~/env";

// Common config: keep always-on tracking enabled, but default to an IDLE low-power profile.
// High-accuracy and moving mode are enabled only when an active alert is open.
//
// Notes:
// - We avoid `reset: true` in production because it can unintentionally wipe persisted / configured state.
//   In dev, `reset: true` is useful to avoid config drift while iterating.
// - `maxRecordsToPersist` must be > 1 to support offline catch-up.
export const BASE_GEOLOCATION_CONFIG = {
  // Android Headless Mode (requires registering a headless task entrypoint in index.js)
  enableHeadless: true,

  // Default to low-power (idle) profile; will be overridden when needed.
  desiredAccuracy: BackgroundGeolocation.DESIRED_ACCURACY_LOW,

  // Larger distance filter in idle mode to prevent frequent GPS wakes.
  distanceFilter: 200,

  // debug: true,
  logLevel: BackgroundGeolocation.LOG_LEVEL_VERBOSE,

  // Permission request strategy
  locationAuthorizationRequest: "Always",

  // Lifecycle
  stopOnTerminate: false,
  startOnBoot: true,

  // Background scheduling
  heartbeatInterval: 3600,

  // Android foreground service
  foregroundService: true,
  notification: {
    title: "Alerte Secours",
    text: "Suivi de localisation actif",
    channelName: "Location tracking",
    priority: BackgroundGeolocation.NOTIFICATION_PRIORITY_HIGH,
  },

  // Android 10+ rationale dialog
  backgroundPermissionRationale: {
    title:
      "Autoriser Alerte-Secours à accéder à la localisation en arrière-plan",
    message:
      "Alerte-Secours nécessite la localisation en arrière-plan pour vous alerter en temps réel lorsqu'une personne à proximité a besoin d'aide urgente. Cette fonction est essentielle pour permettre une intervention rapide et efficace en cas d'urgence.",
    positiveAction: "Autoriser",
    negativeAction: "Désactiver",
  },

  // HTTP configuration
  url: env.GEOLOC_SYNC_URL,
  method: "POST",
  httpRootProperty: "location",
  batchSync: false,
  autoSync: true,

  // Persistence: keep enough records for offline catch-up.
  // (The SDK already constrains with maxDaysToPersist; records are deleted after successful upload.)
  maxRecordsToPersist: 1000,
  maxDaysToPersist: 7,

  // Development convenience
  reset: !!__DEV__,

  // Behavior tweaks
  disableProviderChangeRecord: true,
};

export const TRACKING_PROFILES = {
  idle: {
    desiredAccuracy: BackgroundGeolocation.DESIRED_ACCURACY_LOW,
    distanceFilter: 50,
    heartbeatInterval: 3600,
  },
  active: {
    desiredAccuracy: BackgroundGeolocation.DESIRED_ACCURACY_HIGH,
    distanceFilter: TRACK_MOVE,
    heartbeatInterval: 900,
  },
};
