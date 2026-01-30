import BackgroundGeolocation from "react-native-background-geolocation";
import { AppState } from "react-native";
import { createLogger } from "~/lib/logger";
import { BACKGROUND_SCOPES } from "~/lib/logger/scopes";
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
import { getStoredLocation, storeLocation } from "~/location/storage";

import env from "~/env";

import {
  BASE_GEOLOCATION_CONFIG,
  BASE_GEOLOCATION_INVARIANTS,
  TRACKING_PROFILES,
} from "~/location/backgroundGeolocationConfig";
import buildBackgroundGeolocationSetConfigPayload from "~/location/buildBackgroundGeolocationSetConfigPayload";
import {
  ensureBackgroundGeolocationReady,
  setBackgroundGeolocationEventHandlers,
} from "~/location/backgroundGeolocationService";

let trackLocationStartPromise = null;

// Correlation ID to differentiate multiple JS runtimes (eg full `Updates.reloadAsync()`)
// from tree-level reloads (auth/account switch).
const TRACK_LOCATION_INSTANCE_ID = `${Date.now().toString(36)}-${Math.random()
  .toString(16)
  .slice(2, 8)}`;

export default function trackLocation() {
  if (trackLocationStartPromise) return trackLocationStartPromise;

  trackLocationStartPromise = (async () => {
    const locationLogger = createLogger({
      module: BACKGROUND_SCOPES.GEOLOCATION,
      feature: "tracking",
    });

    locationLogger.info("trackLocation() starting", {
      instanceId: TRACK_LOCATION_INSTANCE_ID,
      appState: AppState.currentState,
    });

    let currentProfile = null;
    let authReady = false;
    let appState = AppState.currentState;
    let stopAlertSubscription = null;
    let stopSessionSubscription = null;

    // Pre-login behavior: keep BGGeo running (so we can collect a first point), but disable
    // uploads until we have an auth token.
    let didDisableUploadsForAnonymous = false;
    let didSyncAfterAuth = false;
    let didSyncAfterStartupFix = false;
    let lastMovingEdgeAt = 0;
    const MOVING_EDGE_COOLDOWN_MS = 5 * 60 * 1000;

    const BAD_ACCURACY_THRESHOLD_M = 200;
    const PERSISTED_ACCURACY_GATE_M = 100;

    // NOTE: IDLE previously experimented with `startGeofences()` + an app-managed exit geofence.
    // That approach is now removed.
    // Current design relies on the SDK's stop-detection + stationary geofence
    // (`geolocation.stopOnStationary` + `geolocation.stationaryRadius`) because it is more
    // reliable in background/locked scenarios.

    // Fallback: if the OS fails to deliver geofence EXIT while the phone is locked, allow
    // exactly one persisted fix when we get strong evidence of movement (motion+activity).
    const IDLE_MOVEMENT_FALLBACK_COOLDOWN_MS = 15 * 60 * 1000;
    let lastActivity = null;
    let lastActivityConfidence = 0;
    let lastIdleMovementFallbackAt = 0;

    // Diagnostics fields retained so server-side correlation can continue to work.
    // This is *not* a managed geofence anymore; it's a reference center for observability.
    let lastEnsuredIdleReferenceAt = 0;
    let lastIdleReferenceCenter = null;
    let lastIdleReferenceCenterAccuracyM = null;
    let lastIdleReferenceCenterTimestamp = null;
    let lastIdleReferenceCenterSource = null;

    // A) Safeguard: when entering IDLE, ensure we have a reasonably accurate and recent
    // reference point.  This does NOT persist/upload; it only updates our stored last-known
    // location and tracking extras.
    const IDLE_REFERENCE_TARGET_ACCURACY_M = 50;
    const IDLE_REFERENCE_MAX_AGE_MS = 5 * 60 * 1000;
    const ensureIdleReferenceFix = async () => {
      try {
        const stored = await getStoredLocation();
        const storedCoords = stored?.coords;
        const storedAcc =
          typeof storedCoords?.accuracy === "number"
            ? storedCoords.accuracy
            : null;
        const storedTs = stored?.timestamp;
        const storedAgeMs = storedTs
          ? Date.now() - new Date(storedTs).getTime()
          : null;

        const isRecentEnough =
          typeof storedAgeMs === "number" && storedAgeMs >= 0
            ? storedAgeMs <= IDLE_REFERENCE_MAX_AGE_MS
            : false;
        const isAccurateEnough =
          typeof storedAcc === "number"
            ? storedAcc <= IDLE_REFERENCE_TARGET_ACCURACY_M
            : false;

        if (
          storedCoords?.latitude &&
          storedCoords?.longitude &&
          isRecentEnough &&
          isAccurateEnough
        ) {
          lastIdleReferenceCenter = {
            latitude: storedCoords.latitude,
            longitude: storedCoords.longitude,
          };
          lastIdleReferenceCenterAccuracyM = storedAcc;
          lastIdleReferenceCenterTimestamp = storedTs ?? null;
          lastIdleReferenceCenterSource = "stored";
          lastEnsuredIdleReferenceAt = Date.now();
          void updateTrackingContextExtras("idle_reference_ok");
          return;
        }

        const fix = await getCurrentPositionWithDiagnostics(
          {
            samples: 2,
            timeout: 30,
            maximumAge: 0,
            desiredAccuracy: IDLE_REFERENCE_TARGET_ACCURACY_M,
            extras: {
              idle_reference_fix: true,
              idle_ref_prev_acc: storedAcc,
              idle_ref_prev_age_ms: storedAgeMs,
            },
          },
          { reason: "idle_reference_fix", persist: false },
        );

        if (fix?.coords?.latitude && fix?.coords?.longitude) {
          storeLocation(fix.coords, fix.timestamp);
          lastIdleReferenceCenter = {
            latitude: fix.coords.latitude,
            longitude: fix.coords.longitude,
          };
          lastIdleReferenceCenterAccuracyM =
            typeof fix.coords.accuracy === "number"
              ? fix.coords.accuracy
              : null;
          lastIdleReferenceCenterTimestamp = fix.timestamp ?? null;
          lastIdleReferenceCenterSource = "idle_reference_fix";
          lastEnsuredIdleReferenceAt = Date.now();
          void updateTrackingContextExtras("idle_reference_fixed");
        }
      } catch (e) {
        locationLogger.debug("Failed to ensure IDLE reference fix", {
          error: e?.message,
        });
      }
    };

    const maybeRequestIdleMovementFallbackFix = async (trigger) => {
      if (currentProfile !== "idle" || !authReady) return;
      if (
        Date.now() - lastIdleMovementFallbackAt <
        IDLE_MOVEMENT_FALLBACK_COOLDOWN_MS
      ) {
        return;
      }

      // Option 2: primary trigger is `onMotionChange(isMoving:true)`.
      // Keep `onActivityChange` as a secondary signal (lower confidence threshold).
      const movingActivities = new Set([
        "walking",
        "running",
        "on_foot",
        "in_vehicle",
        "cycling",
      ]);
      const hasSomeActivitySignal =
        movingActivities.has(lastActivity) && lastActivityConfidence >= 50;

      if (trigger === "activitychange" && !hasSomeActivitySignal) return;

      lastIdleMovementFallbackAt = Date.now();
      locationLogger.info("IDLE movement fallback fix", {
        trigger,
        lastActivity,
        lastActivityConfidence,
      });

      try {
        await getCurrentPositionWithDiagnostics(
          {
            samples: 2,
            timeout: 30,
            maximumAge: 0,
            desiredAccuracy: 50,
            extras: {
              idle_movement_fallback: true,
            },
          },
          { reason: `idle_movement_fallback:${trigger}`, persist: true },
        );
      } catch (e) {
        locationLogger.warn("IDLE movement fallback fix failed", {
          trigger,
          error: e?.message,
        });
      }
    };

    const shouldUseLocationForUi = (location) => {
      const acc = location?.coords?.accuracy;
      return !(typeof acc === "number" && acc > BAD_ACCURACY_THRESHOLD_M);
    };

    // Gate persisted/uploaded points (native layer also filters, but this protects any
    // JS-triggered persisted-fix code-paths).
    const shouldAllowPersistedFix = (location) => {
      const acc = location?.coords?.accuracy;
      return !(typeof acc === "number" && acc > PERSISTED_ACCURACY_GATE_M);
    };

    const getCurrentPositionWithDiagnostics = async (
      options,
      { reason, persist },
    ) => {
      const opts = {
        ...options,
        persist,
        extras: {
          ...(options?.extras || {}),
          // Attribution for log correlation.
          req_reason: reason,
          req_persist: !!persist,
          req_at: new Date().toISOString(),
          req_app_state: appState,
          req_profile: currentProfile,
        },
      };

      locationLogger.debug("Requesting getCurrentPosition", {
        reason,
        persist: !!persist,
        desiredAccuracy: opts?.desiredAccuracy,
        samples: opts?.samples,
        maximumAge: opts?.maximumAge,
        timeout: opts?.timeout,
      });

      return BackgroundGeolocation.getCurrentPosition(opts);
    };

    // Track identity so we can force a first geopoint when the effective user changes.
    let lastSessionUserId = null;

    const updateTrackingContextExtras = async (reason) => {
      try {
        const { userId } = getSessionState();
        const payload = await buildBackgroundGeolocationSetConfigPayload({
          persistence: {
            extras: {
              tracking_ctx: {
                reason,
                app_state: appState,
                profile: currentProfile,
                auth_ready: authReady,
                session_user_id: userId || null,
                // Diagnostics: helps correlate server-side "no update" reports with
                // the last known good reference center when entering IDLE.
                idle_reference: {
                  center: lastIdleReferenceCenter,
                  center_accuracy_m: lastIdleReferenceCenterAccuracyM,
                  center_timestamp: lastIdleReferenceCenterTimestamp,
                  center_source: lastIdleReferenceCenterSource,
                  ensured_at: lastEnsuredIdleReferenceAt || null,
                },
                at: new Date().toISOString(),
              },
            },
          },
        });
        await BackgroundGeolocation.setConfig(payload);
      } catch (e) {
        // Non-fatal: extras are only for observability/debugging.
        locationLogger.debug("Failed to update BGGeo tracking extras", {
          reason,
          error: e?.message,
        });
      }
    };

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    // NOTE: Do not delete records from JS as a primary upload-filtering mechanism.
    // When JS is suspended in background, deletions won't happen but native autoSync will.
    // We keep this as a placeholder in case we later introduce a *server-side* filtering
    // strategy or a safer native-side filter.
    const pruneBadLocations = async () => 0;

    const safeSync = async (reason) => {
      // Sync can fail transiently (SDK busy, network warming up, etc).  Retry a few times.
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const [state, pendingBefore] = await Promise.all([
            BackgroundGeolocation.getState(),
            BackgroundGeolocation.getCount(),
          ]);

          const pruned = await pruneBadLocations();

          locationLogger.info("Attempting BGGeo sync", {
            reason,
            attempt,
            enabled: state?.enabled,
            isMoving: state?.isMoving,
            trackingMode: state?.trackingMode,
            pendingBefore,
            pruned,
          });

          const records = await BackgroundGeolocation.sync();
          const pendingAfter = await BackgroundGeolocation.getCount();

          locationLogger.info("BGGeo sync success", {
            reason,
            attempt,
            synced: records?.length,
            pendingAfter,
          });
          return true;
        } catch (e) {
          const msg =
            typeof e === "string"
              ? e
              : e?.message || e?.error || JSON.stringify(e);
          locationLogger.warn("BGGeo sync failed", {
            reason,
            attempt,
            error: msg,
            stack: e?.stack,
          });
          await sleep(attempt * 1000);
        }
      }
      return false;
    };

    const requestIdentityPersistedFixAndSync = async ({ reason, userId }) => {
      try {
        const t0 = Date.now();
        const location = await getCurrentPositionWithDiagnostics(
          {
            samples: 1,
            timeout: 30,
            maximumAge: 0,
            desiredAccuracy: 50,
            extras: {
              identity_fix: true,
              identity_reason: reason,
              session_user_id: userId,
            },
          },
          { reason: `identity_fix:${reason}`, persist: true },
        );

        if (!shouldAllowPersistedFix(location)) {
          locationLogger.info(
            "Identity persisted fix ignored due to poor accuracy",
            {
              reason,
              userId,
              accuracy: location?.coords?.accuracy,
            },
          );
        }
        locationLogger.info("Identity persisted fix acquired", {
          reason,
          userId,
          ms: Date.now() - t0,
          accuracy: location?.coords?.accuracy,
          latitude: location?.coords?.latitude,
          longitude: location?.coords?.longitude,
          timestamp: location?.timestamp,
        });
      } catch (e) {
        locationLogger.warn("Identity persisted fix failed", {
          reason,
          userId,
          error: e?.message,
          stack: e?.stack,
        });
      }

      await safeSync(`identity-fix:${reason}`);
    };

    // One-off startup refresh: when tracking is enabled at app launch, fetch a fresh fix once.
    // This follows Transistorsoft docs guidance to use getCurrentPosition rather than forcing
    // the SDK into moving mode with changePace(true).
    let didRequestStartupFix = false;
    let startupFixInFlight = null;

    // Startup fix should be persisted so it can be auto-synced immediately (user expects
    // to appear on server soon after first app open).
    //
    // IMPORTANT: restrict this to the ACTIVE profile only.
    // Persisted startup fixes while IDLE can create "no-move" uploads on some devices.
    const requestStartupPersistedFix = async () => {
      try {
        const before = await BackgroundGeolocation.getState();
        locationLogger.info("Requesting startup persisted location fix", {
          enabled: before.enabled,
          trackingMode: before.trackingMode,
          isMoving: before.isMoving,
        });

        if (currentProfile !== "active") {
          locationLogger.info("Skipping startup persisted fix (not ACTIVE)", {
            currentProfile,
          });
          return;
        }

        const t0 = Date.now();
        const location = await getCurrentPositionWithDiagnostics(
          {
            samples: 1,
            timeout: 30,
            maximumAge: 10000,
            desiredAccuracy: 100,
            extras: {
              startup_fix: true,
            },
          },
          { reason: "startup_fix", persist: true },
        );

        if (!shouldAllowPersistedFix(location)) {
          locationLogger.info(
            "Startup persisted fix ignored due to poor accuracy",
            {
              accuracy: location?.coords?.accuracy,
              timestamp: location?.timestamp,
            },
          );
          return;
        }

        locationLogger.info("Startup persisted fix acquired", {
          ms: Date.now() - t0,
          accuracy: location?.coords?.accuracy,
          latitude: location?.coords?.latitude,
          longitude: location?.coords?.longitude,
          timestamp: location?.timestamp,
        });

        // If uploads are currently disabled (pre-login), we'll flush this record once auth
        // becomes available.

        // If uploads are enabled, proactively flush now to guarantee server receives the
        // first point quickly even if the SDK doesn't auto-sync immediately.
        if (authReady && !didSyncAfterStartupFix) {
          const ok = await safeSync("startup-fix");
          if (ok) didSyncAfterStartupFix = true;
        }
      } catch (error) {
        locationLogger.warn("Startup persisted fix failed", {
          error: error?.message,
          code: error?.code,
          stack: error?.stack,
        });
      }
    };

    // When auth changes, we want a fresh location fix (UI-only) to refresh the app state.
    // Debounced to avoid spamming `getCurrentPosition` if auth updates quickly (refresh/renew).
    let authFixDebounceTimerId = null;
    let authFixInFlight = null;
    const AUTH_FIX_DEBOUNCE_MS = 1500;
    const AUTH_FIX_COOLDOWN_MS = 15 * 60 * 1000;
    let lastAuthFixAt = 0;

    // Avoid periodic UI-only getCurrentPosition while app is backgrounded, since
    // this is a common source of "updates while stationary" (it can also influence
    // motion state / generate provider churn on some Android devices).
    const shouldAllowUiFixes = () => appState === "active";

    const scheduleAuthFreshFix = () => {
      // Do not perform UI refresh fixes while backgrounded.
      if (!shouldAllowUiFixes()) {
        return authFixInFlight;
      }

      // Avoid generating persisted + auto-synced locations as a side-effect of frequent
      // auth refreshes (eg app resume / screen unlock).
      if (Date.now() - lastAuthFixAt < AUTH_FIX_COOLDOWN_MS) {
        return authFixInFlight;
      }

      if (authFixDebounceTimerId) {
        clearTimeout(authFixDebounceTimerId);
        authFixDebounceTimerId = null;
      }

      authFixInFlight = new Promise((resolve) => {
        authFixDebounceTimerId = setTimeout(resolve, AUTH_FIX_DEBOUNCE_MS);
      }).then(async () => {
        try {
          const before = await BackgroundGeolocation.getState();
          locationLogger.info("Requesting auth-change location fix", {
            enabled: before.enabled,
            trackingMode: before.trackingMode,
            isMoving: before.isMoving,
          });

          // If we're already in ACTIVE, the profile transition will request an immediate
          // high-accuracy persisted fix.  Avoid duplicating work here.
          if (currentProfile === "active") {
            return;
          }

          const location = await getCurrentPositionWithDiagnostics(
            {
              samples: 1,
              timeout: 20,
              maximumAge: 10000,
              desiredAccuracy: 100,
              extras: {
                auth_token_update: true,
              },
            },
            { reason: "auth_change_ui_fix", persist: false },
          );

          // If the fix is very poor accuracy, treat it as noise and do nothing.
          // (We intentionally do not persist in this path.)
          const acc = location?.coords?.accuracy;
          if (typeof acc === "number" && acc > 100) {
            locationLogger.info(
              "Auth-change fix ignored due to poor accuracy",
              {
                accuracy: acc,
              },
            );
            return;
          }

          locationLogger.info("Auth-change location fix acquired", {
            accuracy: location?.coords?.accuracy,
            latitude: location?.coords?.latitude,
            longitude: location?.coords?.longitude,
            timestamp: location?.timestamp,
          });

          // NOTE: This is a non-persisted fix; it updates UI only.
          // We intentionally do not trigger sync here to avoid network activity
          // without a movement-triggered persisted record.
          lastAuthFixAt = Date.now();
        } catch (error) {
          locationLogger.warn("Auth-change location fix failed", {
            error: error?.message,
            code: error?.code,
            stack: error?.stack,
          });
        } finally {
          authFixDebounceTimerId = null;
          authFixInFlight = null;
        }
      });

      return authFixInFlight;
    };

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

      // IMPORTANT:
      // Do not assume the native SDK runtime mode still matches our JS `currentProfile`.
      // During identity switch / tree reload, we can remain in the same logical profile
      // while native state drifts (eg `trackingMode` remains geofence-only but geofences
      // are missing, leading to "moving but no updates").
      //
      // If profile is unchanged, perform a lightweight runtime ensure.
      // We no longer use geofence-only tracking; ensure we are not stuck in it.
      if (currentProfile === profileName) {
        try {
          const state = await BackgroundGeolocation.getState();

          if (profileName === "idle") {
            // Ensure we are not stuck in geofence-only mode.
            if (state?.trackingMode === 0) {
              await BackgroundGeolocation.start();
            }
            locationLogger.debug("Profile unchanged; IDLE runtime ensured", {
              instanceId: TRACK_LOCATION_INSTANCE_ID,
              trackingMode: state?.trackingMode,
              enabled: state?.enabled,
            });
            void ensureIdleReferenceFix();
          }

          if (profileName === "active") {
            // If we previously called `startGeofences()`, the SDK can remain in geofence-only
            // mode until we explicitly call `start()` again.
            if (state?.trackingMode === 0) {
              await BackgroundGeolocation.start();
            }
            locationLogger.debug("Profile unchanged; ACTIVE runtime ensured", {
              instanceId: TRACK_LOCATION_INSTANCE_ID,
              trackingMode: state?.trackingMode,
              enabled: state?.enabled,
            });
          }
        } catch (e) {
          locationLogger.debug(
            "Failed to ensure runtime for unchanged profile",
            {
              profileName,
              error: e?.message,
            },
          );
        }
        return;
      }

      const applyStartedAt = Date.now();

      // Diagnostic snapshot (debug only) to help understand trackingMode transitions.
      let preState = null;
      try {
        preState = await BackgroundGeolocation.getState();
        locationLogger.debug("Applying tracking profile (pre-state)", {
          profileName,
          instanceId: TRACK_LOCATION_INSTANCE_ID,
          enabled: preState?.enabled,
          isMoving: preState?.isMoving,
          trackingMode: preState?.trackingMode,
          distanceFilter: preState?.geolocation?.distanceFilter,
        });
      } catch (e) {
        locationLogger.debug(
          "Failed to read BGGeo state before profile apply",
          {
            profileName,
            error: e?.message,
          },
        );
      }

      const profile = TRACKING_PROFILES[profileName];
      if (!profile) {
        locationLogger.warn("Unknown tracking profile", { profileName });
        return;
      }

      locationLogger.info("Applying tracking profile", {
        profileName,
        desiredAccuracy: profile?.geolocation?.desiredAccuracy,
        distanceFilter: profile?.geolocation?.distanceFilter,
        heartbeatInterval: profile?.app?.heartbeatInterval,
      });

      try {
        const payload = await buildBackgroundGeolocationSetConfigPayload(
          profile,
        );
        await BackgroundGeolocation.setConfig(payload);

        // Motion state strategy:
        // - ACTIVE: force moving to begin aggressive tracking immediately.
        // - IDLE: ensure we are not stuck in moving mode from a prior ACTIVE session.
        //   We explicitly exit moving mode to avoid periodic drift-generated locations
        //   being produced + uploaded while the user is stationary (reported on Android).
        //   After that, let the SDK's motion detection manage moving/stationary
        //   transitions so we still get distance-based updates when the user truly moves.
        if (profileName === "active") {
          const state = await BackgroundGeolocation.getState();

          // If we were previously in geofence-only mode, switch back to standard tracking.
          // Without this, calling `changePace(true)` is not sufficient on some devices,
          // and the SDK can stay in `trackingMode: 0` (geofence-only), producing no
          // distance-based updates while moving.
          if (state?.trackingMode === 0) {
            await BackgroundGeolocation.start();
          }

          if (!state?.isMoving) {
            await BackgroundGeolocation.changePace(true);
          }

          // Guarantee a rapid first fix for ACTIVE: request a high-accuracy persisted location
          // immediately after entering moving mode.  This is preferred over relying solely on
          // motion-detection / distanceFilter to produce the first point.
          try {
            const beforeFix = Date.now();
            const fix = await getCurrentPositionWithDiagnostics(
              {
                samples: 3,
                timeout: 30,
                maximumAge: 0,
                desiredAccuracy: 10,
                extras: {
                  active_profile_enter: true,
                },
              },
              { reason: "active_profile_enter", persist: true },
            );

            if (!shouldAllowPersistedFix(fix)) {
              locationLogger.info(
                "ACTIVE immediate persisted fix ignored due to poor accuracy",
                {
                  accuracy: fix?.coords?.accuracy,
                },
              );
              return;
            }
            locationLogger.info("ACTIVE immediate fix acquired", {
              ms: Date.now() - beforeFix,
              accuracy: fix?.coords?.accuracy,
              latitude: fix?.coords?.latitude,
              longitude: fix?.coords?.longitude,
              timestamp: fix?.timestamp,
            });

            // Prevent duplicated "moving-edge" persisted fix right after entering ACTIVE.
            lastMovingEdgeAt = Date.now();
          } catch (error) {
            locationLogger.warn("ACTIVE immediate fix failed", {
              error: error?.message,
              code: error?.code,
              stack: error?.stack,
            });
          }
        } else {
          const state = await BackgroundGeolocation.getState();
          if (state?.isMoving) {
            await BackgroundGeolocation.changePace(false);
          }
        }

        currentProfile = profileName;

        // Update extras for observability (profile transitions are a key lifecycle change).
        updateTrackingContextExtras(`profile:${profileName}`);

        // For IDLE, ensure we are NOT in geofence-only tracking mode.
        if (profileName === "idle") {
          try {
            const s = await BackgroundGeolocation.getState();
            if (s?.trackingMode === 0) {
              await BackgroundGeolocation.start();
            }
          } catch {
            // ignore
          }
          void ensureIdleReferenceFix();
        }

        // Post-state snapshot (debug) to detect unintended geofence-only mode.
        try {
          const post = await BackgroundGeolocation.getState();
          locationLogger.debug("Tracking profile applied (post-state)", {
            profileName,
            instanceId: TRACK_LOCATION_INSTANCE_ID,
            enabled: post?.enabled,
            isMoving: post?.isMoving,
            trackingMode: post?.trackingMode,
            distanceFilter: post?.geolocation?.distanceFilter,
            prevTrackingMode: preState?.trackingMode ?? null,
          });
        } catch (e) {
          locationLogger.debug(
            "Failed to read BGGeo state after profile apply",
            {
              profileName,
              error: e?.message,
            },
          );
        }

        try {
          const state = await BackgroundGeolocation.getState();
          locationLogger.info("Tracking profile applied", {
            profileName,
            ms: Date.now() - applyStartedAt,
            enabled: state?.enabled,
            isMoving: state?.isMoving,
            trackingMode: state?.trackingMode,
          });
        } catch (e) {
          locationLogger.debug("Tracking profile applied (state unavailable)", {
            profileName,
            ms: Date.now() - applyStartedAt,
            error: e?.message,
          });
        }
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
      // Defensive: ensure `.ready()` is resolved before any API call.
      await ensureBackgroundGeolocationReady(BASE_GEOLOCATION_CONFIG);

      locationLogger.info("Handling auth token update", {
        hasToken: !!userToken,
        instanceId: TRACK_LOCATION_INSTANCE_ID,
      });

      // Snapshot state early (debug only) to diagnose "no uploads" reports after auth refresh.
      if (__DEV__ || env.IS_STAGING) {
        try {
          const s = await BackgroundGeolocation.getState();
          locationLogger.debug("Auth-change BGGeo state snapshot", {
            instanceId: TRACK_LOCATION_INSTANCE_ID,
            enabled: s?.enabled,
            isMoving: s?.isMoving,
            trackingMode: s?.trackingMode,
          });
        } catch (e) {
          locationLogger.debug("Auth-change BGGeo state snapshot failed", {
            error: e?.message,
          });
        }
      }

      // Compute identity from session store; this is our source of truth.
      // (A token refresh for the same user should not force a new persisted fix.)
      let currentSessionUserId = null;
      try {
        currentSessionUserId = getSessionState()?.userId ?? null;
      } catch (e) {
        currentSessionUserId = null;
      }
      if (!userToken && !currentSessionUserId) {
        // Pre-login mode: keep tracking enabled but disable uploads.
        // Also applies to logout: keep tracking on (per product requirement: track all the time),
        // but stop sending anything to server without auth.
        locationLogger.info(
          "No auth token: disabling BGGeo uploads (keeping tracking on)",
        );

        try {
          const payload = await buildBackgroundGeolocationSetConfigPayload({
            http: {
              url: "",
              autoSync: false,
              headers: {},
            },
          });
          await BackgroundGeolocation.setConfig(payload);
          didDisableUploadsForAnonymous = true;
          didSyncAfterAuth = false;
        } catch (e) {
          locationLogger.warn("Failed to disable BGGeo uploads (anonymous)", {
            error: e?.message,
          });
        }

        const state = await BackgroundGeolocation.getState();
        if (!state.enabled) {
          try {
            await BackgroundGeolocation.start();
            locationLogger.debug("Location tracking started in anonymous mode");
          } catch (error) {
            locationLogger.error(
              "Failed to start location tracking in anonymous mode",
              {
                error: error.message,
                stack: error.stack,
              },
            );
          }
        }

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

        // Ensure server/debug can see the app lifecycle context even pre-auth.
        updateTrackingContextExtras("auth:anonymous");

        if (authFixDebounceTimerId) {
          clearTimeout(authFixDebounceTimerId);
          authFixDebounceTimerId = null;
        }
        authFixInFlight = null;

        // Still request a one-time persisted fix at startup in anonymous mode so we have
        // something to flush immediately after auth.
        if (!didRequestStartupFix) {
          didRequestStartupFix = true;
          startupFixInFlight = requestStartupPersistedFix();
        }

        lastSessionUserId = null;
        return;
      }
      locationLogger.debug("Updating background geolocation config");
      {
        const payload = await buildBackgroundGeolocationSetConfigPayload({
          http: {
            // Update the sync URL for when it's changed for staging
            url: env.GEOLOC_SYNC_URL,
            // IMPORTANT: enable native uploading when authenticated.
            // This ensures uploads continue even if JS is suspended in background.
            autoSync: true,
            batchSync: false,
            autoSyncThreshold: 0,
            headers: {
              Authorization: `Bearer ${userToken}`,
            },
          },
        });
        await BackgroundGeolocation.setConfig(payload);
      }

      authReady = true;

      updateTrackingContextExtras("auth:ready");

      // Log the authorization header that was set
      locationLogger.debug(
        "Set Authorization header for background geolocation",
        {
          headerSet: true,
          tokenPrefix: userToken ? userToken.substring(0, 10) + "..." : null,
        },
      );

      const state = await BackgroundGeolocation.getState();

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

      // If identity has changed (including first login), force a persisted fix for this identity
      // and sync immediately so the new identity has an immediate first geopoint.
      if (currentSessionUserId && currentSessionUserId !== lastSessionUserId) {
        const reason = lastSessionUserId ? "user-switch" : "first-login";
        locationLogger.info("Identity change detected", {
          reason,
          from: lastSessionUserId,
          to: currentSessionUserId,
        });
        lastSessionUserId = currentSessionUserId;
        await requestIdentityPersistedFixAndSync({
          reason,
          userId: currentSessionUserId,
        });
      }

      // If we were previously in anonymous mode, flush any queued persisted locations now.
      if (didDisableUploadsForAnonymous && !didSyncAfterAuth) {
        try {
          if (startupFixInFlight) {
            await startupFixInFlight;
          }
          const ok = await safeSync("pre-auth-flush");
          didSyncAfterAuth = ok;
        } catch (e) {
          locationLogger.warn("Pre-auth flush failed", {
            error: e?.message,
            stack: e?.stack,
          });
        }
      }

      // Always request a fresh UI-only fix on any token update.
      scheduleAuthFreshFix();

      // Request a single fresh location-fix on each app launch when tracking is enabled.
      // - We do this only after auth headers are configured so the persisted point can sync.
      // - We do NOT force moving mode.
      // - We only persist in ACTIVE.
      if (!didRequestStartupFix) {
        didRequestStartupFix = true;
        // Profile isn't applied yet. We'll request the startup fix after we apply the profile.
      } else if (authFixInFlight) {
        // Avoid concurrent fix calls if auth updates race.
        await authFixInFlight;
      }

      // Ensure we are NOT forcing "moving" mode by default.
      // Default profile is idle unless an active alert requires higher accuracy.
      const shouldBeActive = computeHasOwnOpenAlert();
      await applyProfile(shouldBeActive ? "active" : "idle");

      // Now that profile is applied, execute the persisted startup fix if needed.
      if (didRequestStartupFix && !startupFixInFlight) {
        startupFixInFlight = requestStartupPersistedFix();
      }

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

    setBackgroundGeolocationEventHandlers({
      onLocation: async (location) => {
        locationLogger.debug("Location update received", {
          uuid: location?.uuid,
          sample: location?.sample,
          accuracy: location?.coords?.accuracy,
          latitude: location?.coords?.latitude,
          longitude: location?.coords?.longitude,
          timestamp: location?.timestamp,
          activity: location?.activity,
          extras: location?.extras,
        });

        // Ignore sampling locations (eg, emitted during getCurrentPosition) to avoid UI/storage churn.
        // The final persisted location will arrive with sample=false.
        if (location.sample) return;

        // Quality gate (UI-only): if accuracy is very poor, ignore for UI/state.
        // Do NOT delete the record here; native uploads may happen while JS is suspended.
        if (!shouldUseLocationForUi(location)) {
          locationLogger.info("Ignoring poor-accuracy location", {
            accuracy: location?.coords?.accuracy,
            uuid: location?.uuid,
          });
          return;
        }

        if (
          location.coords &&
          location.coords.latitude &&
          location.coords.longitude
        ) {
          setLocationState(location.coords);
          // Also store in AsyncStorage for last known location fallback
          storeLocation(location.coords, location.timestamp);

          // If we're IDLE, update reference center for later correlation.
          if (currentProfile === "idle") {
            lastIdleReferenceCenter = {
              latitude: location.coords.latitude,
              longitude: location.coords.longitude,
            };
            lastIdleReferenceCenterAccuracyM =
              typeof location.coords.accuracy === "number"
                ? location.coords.accuracy
                : null;
            lastIdleReferenceCenterTimestamp = location.timestamp ?? null;
            lastIdleReferenceCenterSource = "onLocation";
            lastEnsuredIdleReferenceAt = Date.now();
            void updateTrackingContextExtras("idle_reference_updated");
          }
        }
      },
      onGeofence: async (event) => {
        // Diagnostic only: geofences are still used internally by the SDK (eg stationary geofence)
        // even when we don't manage any app-defined geofences.
        try {
          const state = await BackgroundGeolocation.getState();
          locationLogger.info("Geofence event", {
            identifier: event?.identifier,
            action: event?.action,
            accuracy: event?.location?.coords?.accuracy,
            latitude: event?.location?.coords?.latitude,
            longitude: event?.location?.coords?.longitude,
            enabled: state?.enabled,
            isMoving: state?.isMoving,
            trackingMode: state?.trackingMode,
            profile: currentProfile,
            appState,
          });
        } catch (e) {
          locationLogger.info("Geofence event", {
            identifier: event?.identifier,
            action: event?.action,
            accuracy: event?.location?.coords?.accuracy,
            latitude: event?.location?.coords?.latitude,
            longitude: event?.location?.coords?.longitude,
            profile: currentProfile,
            appState,
            error: e?.message,
          });
        }
      },
      onLocationError: (error) => {
        locationLogger.warn("Location error", {
          error: error?.message,
          code: error?.code,
        });
      },
      onHttp: async (response) => {
        // Log success/failure for visibility into token expiry, server errors, etc.
        locationLogger.debug("HTTP response received", {
          success: response?.success,
          status: response?.status,
          responseText: response?.responseText,
        });

        // Lightweight instrumentation only when useful:
        // - non-success responses
        // - dev/staging visibility
        const shouldInstrumentHttp =
          !response?.success || __DEV__ || env.IS_STAGING;
        if (!shouldInstrumentHttp) return;

        try {
          const [state, count] = await Promise.all([
            BackgroundGeolocation.getState(),
            BackgroundGeolocation.getCount(),
          ]);
          locationLogger.debug("HTTP instrumentation", {
            success: response?.success,
            status: response?.status,
            enabled: state?.enabled,
            isMoving: state?.isMoving,
            trackingMode: state?.trackingMode,
            pendingCount: count,
          });
        } catch (e) {
          locationLogger.debug("Failed HTTP instrumentation", {
            error: e?.message,
          });
        }
      },
      onMotionChange: (event) => {
        // Essential motion diagnostics (avoid spam; keep it one log per edge).
        locationLogger.info("Motion change", {
          instanceId: TRACK_LOCATION_INSTANCE_ID,
          profile: currentProfile,
          appState,
          authReady,
          isMoving: event?.isMoving,
          accuracy: event?.location?.coords?.accuracy,
          speed: event?.location?.coords?.speed,
        });

        // Moving-edge strategy: when we enter moving state, force one persisted high-quality
        // point + sync so the server gets a quick update.
        //
        // IMPORTANT: Restrict this to ACTIVE tracking only.  On Android, motion detection can
        // produce false-positive moving transitions while the device is stationary (screen-off),
        // which would otherwise trigger unwanted background uploads.
        // Cooldown to avoid repeated work due to motion jitter.
        if (event?.isMoving && authReady && currentProfile === "active") {
          const now = Date.now();
          if (now - lastMovingEdgeAt >= MOVING_EDGE_COOLDOWN_MS) {
            lastMovingEdgeAt = now;
            (async () => {
              try {
                const fix = await getCurrentPositionWithDiagnostics(
                  {
                    samples: 1,
                    timeout: 30,
                    maximumAge: 0,
                    desiredAccuracy: 50,
                    extras: {
                      moving_edge: true,
                    },
                  },
                  { reason: "moving_edge", persist: true },
                );

                if (!shouldAllowPersistedFix(fix)) {
                  locationLogger.info(
                    "Moving-edge persisted fix ignored due to poor accuracy",
                    {
                      accuracy: fix?.coords?.accuracy,
                    },
                  );
                  return;
                }
                locationLogger.info("Moving-edge fix acquired", {
                  accuracy: fix?.coords?.accuracy,
                  latitude: fix?.coords?.latitude,
                  longitude: fix?.coords?.longitude,
                  timestamp: fix?.timestamp,
                });
              } catch (e) {
                locationLogger.warn("Moving-edge fix failed", {
                  error: e?.message,
                  stack: e?.stack,
                });
              }
              await safeSync("moving-edge");
            })();
          }
        }

        // IDLE fallback: if we get a real motion transition while locked but geofence EXIT
        // is not delivered reliably, request one persisted fix (gated + cooled down).
        if (event?.isMoving && currentProfile === "idle" && authReady) {
          void maybeRequestIdleMovementFallbackFix("motionchange");
        }
      },
      onActivityChange: (event) => {
        locationLogger.debug("Activity change", {
          activity: event?.activity,
          confidence: event?.confidence,
        });

        lastActivity = event?.activity;
        lastActivityConfidence = event?.confidence ?? 0;

        if (currentProfile === "idle" && authReady) {
          void maybeRequestIdleMovementFallbackFix("activitychange");
        }
      },
      onProviderChange: (event) => {
        locationLogger.info("Provider change", {
          status: event?.status,
          enabled: event?.enabled,
          network: event?.network,
          gps: event?.gps,
          accuracyAuthorization: event?.accuracyAuthorization,
        });
      },
      onConnectivityChange: (event) => {
        locationLogger.debug("Connectivity change", {
          connected: event?.connected,
        });
      },
      onEnabledChange: (enabled) => {
        locationLogger.info("Enabled change", { enabled });
      },
    });

    try {
      locationLogger.info("Initializing background geolocation");
      await ensureBackgroundGeolocationReady(BASE_GEOLOCATION_CONFIG);

      // Tag app foreground/background transitions so we can reason about uploads & locations.
      // Note: there is no reliable JS signal for "terminated" when `enableHeadless:false`.
      try {
        const sub = AppState.addEventListener("change", (next) => {
          const prev = appState;
          appState = next;
          locationLogger.info("AppState changed", { from: prev, to: next });
          updateTrackingContextExtras("app_state");
        });
        // Keep the subscription alive for the app lifetime.
        // (trackLocation is a singleton init; no teardown is expected.)
        void sub;
      } catch (e) {
        locationLogger.debug("Failed to register AppState listener", {
          error: e?.message,
        });
      }

      // Ensure critical config cannot drift due to persisted plugin state.
      // (We intentionally keep auth headers separate and set them in handleAuth.)
      try {
        const payload = await buildBackgroundGeolocationSetConfigPayload(
          BASE_GEOLOCATION_INVARIANTS,
        );
        await BackgroundGeolocation.setConfig(payload);
      } catch (e) {
        locationLogger.warn("Failed to apply BGGeo base invariants", {
          error: e?.message,
          stack: e?.stack,
        });
      }

      // Initial extras snapshot (even before auth) for observability.
      updateTrackingContextExtras("startup");

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
  })();

  return trackLocationStartPromise;
}
