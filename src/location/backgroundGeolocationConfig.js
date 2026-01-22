import BackgroundGeolocation from "react-native-background-geolocation";
import env from "~/env";

// Common config: keep always-on tracking enabled, but default to an IDLE low-power profile.
// High-accuracy and tighter distance thresholds are enabled only when an active alert is open.
//
// Expected behavior (both Android + iOS):
// - Foreground: locations recorded only after moving beyond `distanceFilter`.
// - Background: same rule; native service continues even if JS is suspended.
// - Terminated:
//   - Android: native service continues (`stopOnTerminate:false`); JS headless is NOT required.
//   - iOS: OS will relaunch app on significant movement / stationary-geofence exit.
//
// NOTE: We avoid creating persisted records from UI-only lookups (eg map refresh), since
// persisted records can trigger native HTTP uploads even while stationary.
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
  // Android Headless Mode
  // We do not require JS execution while terminated.  Native tracking + native HTTP upload
  // are sufficient for our needs (stopOnTerminate:false).
  enableHeadless: false,

  // Default to low-power (idle) profile; will be overridden when needed.
  desiredAccuracy: BackgroundGeolocation.DESIRED_ACCURACY_LOW,

  // Default to the IDLE profile behaviour: we still want distance-based updates
  // even with no open alert (see TRACKING_PROFILES.idle).
  distanceFilter: 200,

  // Activity-recognition stop-detection.
  // NOTE: Transistorsoft defaults `stopTimeout` to 5 minutes (see
  // [`node_modules/react-native-background-geolocation/src/declarations/interfaces/Config.d.ts:79`](node_modules/react-native-background-geolocation/src/declarations/interfaces/Config.d.ts:79)).
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
  // IMPORTANT: Default to uploads disabled until we have an auth token.
  // Authenticated mode will set `url` + `Authorization` header and enable `autoSync`.
  url: "",
  method: "POST",
  httpRootProperty: "location",
  // Keep uploads simple: 1 location record -> 1 HTTP request.
  // (We intentionally keep only the latest record; batching provides no benefit.)
  autoSync: false,
  // Ensure no persisted config can keep batching/threshold behavior.
  batchSync: false,
  autoSyncThreshold: 0,

  // Persistence
  // Product requirement: keep only the latest geopoint.  This reduces on-device storage
  // and avoids building up a queue.
  // NOTE: This means we intentionally do not support offline catch-up of multiple points.
  maxRecordsToPersist: 1,
  maxDaysToPersist: 1,

  // Development convenience
  reset: !!__DEV__,

  // Behavior tweaks
  disableProviderChangeRecord: true,
};

// Options we want to be stable across launches even when the plugin loads a persisted config.
// NOTE: We intentionally do *not* include HTTP auth headers here.
export const BASE_GEOLOCATION_INVARIANTS = {
  enableHeadless: false,
  stopOnTerminate: false,
  startOnBoot: true,
  foregroundService: true,
  disableProviderChangeRecord: true,
  // Filter extreme GPS teleports that can create false uploads while stationary.
  // Units: meters/second. 100 m/s ~= 360 km/h.
  speedJumpFilter: 100,
  method: "POST",
  httpRootProperty: "location",
  autoSync: false,
  batchSync: false,
  autoSyncThreshold: 0,
  maxRecordsToPersist: 1,
  maxDaysToPersist: 1,
};

export const TRACKING_PROFILES = {
  idle: {
    desiredAccuracy: BackgroundGeolocation.DESIRED_ACCURACY_LOW,
    // Defensive: keep the distanceFilter conservative to avoid battery drain.
    distanceFilter: 200,

    // Keep the plugin's speed-based distanceFilter scaling enabled (default).
    // This yields fewer updates as speed increases (highway speeds) and helps battery.
    // We intentionally do NOT set `disableElasticity: true`.

    // Android-only: reduce false-positive motion triggers due to screen-on/unlock.
    // (This is ignored on iOS.)
    motionTriggerDelay: 30000,
  },
  active: {
    desiredAccuracy: BackgroundGeolocation.DESIRED_ACCURACY_HIGH,
    // ACTIVE target: frequent updates while moving.
    distanceFilter: 25,

    // Android-only: do not delay motion triggers while ACTIVE.
    motionTriggerDelay: 0,
  },
};
