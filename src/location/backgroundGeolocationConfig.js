import BackgroundGeolocation from "react-native-background-geolocation";
import env from "~/env";

// Common config: keep always-on tracking enabled, but default to an IDLE low-power profile.
// High-accuracy and moving mode are enabled only when an active alert is open.
//
// Product goals:
// - IDLE (no open alert): minimize battery; server updates are acceptable only on OS-level significant movement.
// - ACTIVE (open alert): first location should reach server within seconds, then continuous distance-based updates.
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

  // Default to the IDLE profile behaviour: we still want distance-based updates
  // even with no open alert (see TRACKING_PROFILES.idle).
  distanceFilter: 200,

  // Activity-recognition stop-detection.
  // NOTE: Transistorsoft defaults `stopTimeout` to 5 minutes (see
  // [`node_modules/react-native-background-geolocation/src/declarations/interfaces/Config.d.ts:79`](node_modules/react-native-background-geolocation/src/declarations/interfaces/Config.d.ts:79)).
  // We keep the default in BASE and override it in the IDLE profile to reduce
  // 5-minute stationary cycles observed on Android.
  stopTimeout: 5,

  // debug: true,
  // Logging can become large and also adds overhead; keep verbose logs to dev/staging.
  logLevel:
    __DEV__ || env.IS_STAGING
      ? BackgroundGeolocation.LOG_LEVEL_VERBOSE
      : BackgroundGeolocation.LOG_LEVEL_ERROR,

  // Permission request strategy
  locationAuthorizationRequest: "Always",

  // Lifecycle
  stopOnTerminate: false,
  startOnBoot: true,

  // Background scheduling
  // Disable heartbeats by default to avoid periodic background wakeups while stationary.
  // ACTIVE profile will explicitly enable a fast heartbeat when needed.
  heartbeatInterval: 0,

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

// Options we want to be stable across launches even when the plugin loads a persisted config.
// NOTE: We intentionally do *not* include HTTP auth headers here.
export const BASE_GEOLOCATION_INVARIANTS = {
  enableHeadless: true,
  stopOnTerminate: false,
  startOnBoot: true,
  foregroundService: true,
  disableProviderChangeRecord: true,
  // Filter extreme GPS teleports that can create false uploads while stationary.
  // Units: meters/second. 100 m/s ~= 360 km/h.
  speedJumpFilter: 100,
  method: "POST",
  httpRootProperty: "location",
  maxRecordsToPersist: 1000,
  maxDaysToPersist: 7,
};

export const TRACKING_PROFILES = {
  idle: {
    desiredAccuracy: BackgroundGeolocation.DESIRED_ACCURACY_LOW,
    // Max battery-saving strategy for IDLE:
    // Use Android/iOS low-power significant-change tracking where the OS produces
    // only periodic fixes (several times/hour).  Note many config options like
    // `distanceFilter` / `stationaryRadius` are documented as having little/no
    // effect in this mode.
    useSignificantChangesOnly: true,

    // Defensive: if some devices/platform conditions fall back to standard tracking,
    // keep the distanceFilter conservative to avoid battery drain.
    distanceFilter: 200,

    // Keep the default stop-detection timing (minutes).  In significant-changes
    // mode, stop-detection is not the primary driver of updates.
    stopTimeout: 5,

    // No periodic wakeups while idle.
    heartbeatInterval: 0,
  },
  active: {
    desiredAccuracy: BackgroundGeolocation.DESIRED_ACCURACY_HIGH,
    // Ensure we exit significant-changes mode when switching from IDLE.
    useSignificantChangesOnly: false,
    distanceFilter: 50,
    heartbeatInterval: 60,

    // Keep default responsiveness during an active alert.
    stopTimeout: 5,
  },
};
