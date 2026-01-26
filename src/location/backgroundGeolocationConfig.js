import BackgroundGeolocation from "react-native-background-geolocation";
import env from "~/env";

const LOCATION_ACCURACY_GATE_M = 100;

// Native filter to reduce GPS drift and suppress stationary jitter.
// This is the primary mechanism to prevent unwanted persisted/uploaded points while the device
// is not moving (works even when JS is suspended).
const DEFAULT_LOCATION_FILTER = {
  policy: BackgroundGeolocation.LocationFilterPolicy.Conservative,
  useKalman: true,
  kalmanProfile: BackgroundGeolocation.KalmanProfile.Conservative,
  trackingAccuracyThreshold: LOCATION_ACCURACY_GATE_M,
};

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
// - We keep config deterministic across launches to avoid stale persisted settings creating
//   unexpected periodic wakeups/uploads.
// - `maxRecordsToPersist: 1` matches product requirement (only latest geopoint).
export const BASE_GEOLOCATION_CONFIG = {
  reset: true,

  // Logger config
  logger: {
    // debug: true,
    // Logging can become large and also adds overhead; keep verbose logs to dev/staging.
    logLevel:
      __DEV__ || env.IS_STAGING
        ? BackgroundGeolocation.LogLevel.Verbose
        : BackgroundGeolocation.LogLevel.Error,
  },

  // Geolocation config
  geolocation: {
    // Default profile is IDLE.
    //
    // Important: `DesiredAccuracy.Low` (wifi/cell) can yield very large errors (km-level).
    // Those poor fixes can create false motion/geofence transitions on some Android devices,
    // resulting in periodic uploads while the user is stationary.
    //
    // We default to a GPS-capable accuracy but rely on motion + distance thresholds to
    // protect battery.
    desiredAccuracy: BackgroundGeolocation.DesiredAccuracy.High,

    // Default to the IDLE profile behaviour: we still want distance-based updates
    // even with no open alert (see TRACKING_PROFILES.idle).
    distanceFilter: 200,

    // Prevent dynamic distanceFilter shrink.
    // Elasticity can lower the effective threshold (eg while stationary), resulting in
    // unexpected frequent updates.
    disableElasticity: true,

    // Stop-detection.
    // NOTE: historically we set this at top-level.  In v5 the knob is under `geolocation`.
    stopTimeout: 5,

    // True-stationary strategy: once stop-detection decides we're stationary, stop active
    // tracking and rely on the stationary geofence to detect significant movement.
    // This is intended to eliminate periodic stationary updates on Android.
    stopOnStationary: true,
    stationaryRadius: 200,

    // Prevent identical/noise locations from being persisted.
    // This reduces DB churn and avoids triggering native HTTP uploads with redundant points.
    allowIdenticalLocations: false,

    // Native-side filter (see DEFAULT_LOCATION_FILTER above).
    filter: DEFAULT_LOCATION_FILTER,

    // Permission request strategy
    locationAuthorizationRequest: "Always",
  },

  // Application / lifecycle config
  app: {
    // Android Headless Mode
    // We do not require JS execution while terminated.  Native tracking + native HTTP upload
    // are sufficient for our needs (stopOnTerminate:false).
    enableHeadless: false,

    stopOnTerminate: false,
    startOnBoot: true,

    // Background scheduling
    // Disable heartbeats to avoid periodic background wakeups while stationary.
    heartbeatInterval: 0,

    // Android foreground service notification
    notification: {
      title: "Alerte Secours",
      text: "Suivi de localisation actif",
      channelName: "Location tracking",
      priority: BackgroundGeolocation.NotificationPriority.High,
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
  },

  // HTTP config
  // IMPORTANT: Default to uploads disabled until we have an auth token.
  // Authenticated mode will set `http.url` + `Authorization` header and enable `autoSync`.
  http: {
    url: "",
    method: BackgroundGeolocation.HttpMethod.POST,
    rootProperty: "location",
    // Keep uploads simple: 1 location record -> 1 HTTP request.
    // (We intentionally keep only the latest record; batching provides no benefit.)
    autoSync: false,
    // Ensure no persisted config can keep batching/threshold behavior.
    batchSync: false,
    autoSyncThreshold: 0,
  },

  // Persistence config
  persistence: {
    // Product requirement: keep only the latest geopoint.
    maxRecordsToPersist: 1,
    maxDaysToPersist: 1,

    // Behavior tweaks
    disableProviderChangeRecord: true,
  },
};

// Options we want to be stable across launches even when the plugin loads a persisted config.
// NOTE: We intentionally do *not* include HTTP auth headers here.
export const BASE_GEOLOCATION_INVARIANTS = {
  app: {
    enableHeadless: false,
    stopOnTerminate: false,
    startOnBoot: true,
    // Never allow background heartbeats by default (prevents time-based wakeups/uploads).
    heartbeatInterval: 0,
  },
  http: {
    method: BackgroundGeolocation.HttpMethod.POST,
    rootProperty: "location",
    autoSync: false,
    batchSync: false,
    autoSyncThreshold: 0,
  },
  persistence: {
    maxRecordsToPersist: 1,
    maxDaysToPersist: 1,
    disableProviderChangeRecord: true,
  },
  // NOTE: `speedJumpFilter` was a legacy Config knob; it is not part of v5 shared types.
  // If we still want jump filtering, we'll need to implement a server-side filter or
  // re-introduce a supported SDK filter (eg `geolocation.filter`) when available.
};

export const TRACKING_PROFILES = {
  idle: {
    geolocation: {
      // Same rationale as BASE: prefer GPS-capable accuracy to avoid km-level coarse fixes
      // that can trigger false motion/geofence transitions on Android.
      desiredAccuracy: BackgroundGeolocation.DesiredAccuracy.High,

      // IDLE runtime relies on the SDK's stop-detection + stationary geofence (stopOnStationary).
      // Keep geolocation config conservative for any incidental lookups.
      distanceFilter: 200,
      disableElasticity: true,

      // IMPORTANT: ACTIVE sets stopOnStationary:false.
      // Ensure we restore it when transitioning back to IDLE, otherwise the SDK may
      // continue recording while stationary.
      stopOnStationary: true,

      // QA helper: allow easier validation in dev/staging while keeping production at 200m.
      stationaryRadius: __DEV__ || env.IS_STAGING ? 30 : 200,

      // Keep filtering enabled across profile transitions.
      filter: DEFAULT_LOCATION_FILTER,
      allowIdenticalLocations: false,
    },
    app: {
      // Never use heartbeat-driven updates; only movement-driven.
      heartbeatInterval: 0,
    },
    activity: {
      // Android-only: reduce false-positive motion triggers due to screen-on/unlock.
      // (This is ignored on iOS.)
      motionTriggerDelay: 300000,
    },
  },
  active: {
    geolocation: {
      desiredAccuracy: BackgroundGeolocation.DesiredAccuracy.High,
      // ACTIVE target: frequent updates while moving.
      distanceFilter: 25,

      disableElasticity: true,

      // While ACTIVE, do not stop updates simply because the device appears stationary.
      // Motion-detection + distanceFilter should govern updates.
      stopOnStationary: false,

      // Apply the same native filter while ACTIVE.
      filter: DEFAULT_LOCATION_FILTER,
      allowIdenticalLocations: false,
    },
    app: {
      // Never use heartbeat-driven updates; only movement-driven.
      heartbeatInterval: 0,
    },
    activity: {
      // Android-only: do not delay motion triggers while ACTIVE.
      motionTriggerDelay: 0,
    },
  },
};
