import BackgroundGeolocation from "react-native-background-geolocation";
import { AppState } from "react-native";
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

import {
  BASE_GEOLOCATION_CONFIG,
  BASE_GEOLOCATION_INVARIANTS,
  TRACKING_PROFILES,
} from "~/location/backgroundGeolocationConfig";
import {
  ensureBackgroundGeolocationReady,
  setBackgroundGeolocationEventHandlers,
} from "~/location/backgroundGeolocationService";

let trackLocationStartPromise = null;

export default function trackLocation() {
  if (trackLocationStartPromise) return trackLocationStartPromise;

  trackLocationStartPromise = (async () => {
    const locationLogger = createLogger({
      module: BACKGROUND_SCOPES.GEOLOCATION,
      feature: "tracking",
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

    // Track identity so we can force a first geopoint when the effective user changes.
    let lastSessionUserId = null;

    const updateTrackingContextExtras = async (reason) => {
      try {
        const { userId } = getSessionState();
        await BackgroundGeolocation.setConfig({
          persistence: {
            extras: {
              tracking_ctx: {
                reason,
                app_state: appState,
                profile: currentProfile,
                auth_ready: authReady,
                session_user_id: userId || null,
                at: new Date().toISOString(),
              },
            },
          },
        });
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
        const location = await BackgroundGeolocation.getCurrentPosition({
          samples: 1,
          persist: true,
          timeout: 30,
          maximumAge: 0,
          desiredAccuracy: 50,
          extras: {
            identity_fix: true,
            identity_reason: reason,
            session_user_id: userId,
          },
        });
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
        const location = await BackgroundGeolocation.getCurrentPosition({
          samples: 1,
          persist: true,
          timeout: 30,
          maximumAge: 10000,
          desiredAccuracy: 100,
          extras: {
            startup_fix: true,
          },
        });

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

          const location = await BackgroundGeolocation.getCurrentPosition({
            samples: 1,
            // IMPORTANT: do not persist by default.
            // Persisting will create a DB record and the SDK may upload it on resume,
            // which is the source of "updates while not moved" on some devices.
            persist: false,
            timeout: 20,
            maximumAge: 10000,
            desiredAccuracy: 100,
            extras: {
              auth_token_update: true,
            },
          });

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
      if (currentProfile === profileName) return;

      const applyStartedAt = Date.now();

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
        await BackgroundGeolocation.setConfig(profile);

        // Motion state strategy:
        // - ACTIVE: force moving to begin aggressive tracking immediately.
        // - IDLE: ensure we are not stuck in moving mode from a prior ACTIVE session.
        //   We explicitly exit moving mode to avoid periodic drift-generated locations
        //   being produced + uploaded while the user is stationary (reported on Android).
        //   After that, let the SDK's motion detection manage moving/stationary
        //   transitions so we still get distance-based updates when the user truly moves.
        if (profileName === "active") {
          const state = await BackgroundGeolocation.getState();
          if (!state?.isMoving) {
            await BackgroundGeolocation.changePace(true);
          }

          // Guarantee a rapid first fix for ACTIVE: request a high-accuracy persisted location
          // immediately after entering moving mode.  This is preferred over relying solely on
          // motion-detection / distanceFilter to produce the first point.
          try {
            const beforeFix = Date.now();
            const fix = await BackgroundGeolocation.getCurrentPosition({
              samples: 3,
              persist: true,
              timeout: 30,
              maximumAge: 0,
              desiredAccuracy: 10,
              extras: {
                active_profile_enter: true,
              },
            });
            locationLogger.info("ACTIVE immediate fix acquired", {
              ms: Date.now() - beforeFix,
              accuracy: fix?.coords?.accuracy,
              latitude: fix?.coords?.latitude,
              longitude: fix?.coords?.longitude,
              timestamp: fix?.timestamp,
            });
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
      });

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
          await BackgroundGeolocation.setConfig({
            http: {
              url: "",
              autoSync: false,
              headers: {},
            },
          });
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
      // unsub();
      locationLogger.debug("Updating background geolocation config");
      await BackgroundGeolocation.setConfig({
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
          coords: location.coords,
          timestamp: location.timestamp,
          activity: location.activity,
          battery: location.battery,
          sample: location.sample,
        });

        // Ignore sampling locations (eg, emitted during getCurrentPosition) to avoid UI/storage churn.
        // The final persisted location will arrive with sample=false.
        if (location.sample) return;

        // Quality gate (UI-only): if accuracy is very poor, ignore for UI/state.
        // Do NOT delete the record here; native uploads may happen while JS is suspended.
        const acc = location?.coords?.accuracy;
        if (typeof acc === "number" && acc > BAD_ACCURACY_THRESHOLD_M) {
          locationLogger.info("Ignoring poor-accuracy location", {
            accuracy: acc,
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

        // Instrumentation: when we see periodic HTTP without a corresponding location event,
        // we want to know if BGGeo is retrying an upload queue or flushing new records.
        // This helps diagnose reports like "server receives updates every ~5 minutes while stationary".
        try {
          const [state, count] = await Promise.all([
            BackgroundGeolocation.getState(),
            BackgroundGeolocation.getCount(),
          ]);
          locationLogger.debug("HTTP instrumentation", {
            enabled: state?.enabled,
            isMoving: state?.isMoving,
            trackingMode: state?.trackingMode,
            schedulerEnabled: state?.schedulerEnabled,
            pendingCount: count,
          });
        } catch (e) {
          locationLogger.warn("Failed HTTP instrumentation", {
            error: e?.message,
          });
        }
      },
      onHeartbeat: (event) => {
        // If heartbeat is configured, it can trigger sync attempts even without new locations.
        locationLogger.info("Heartbeat", {
          enabled: event?.state?.enabled,
          isMoving: event?.state?.isMoving,
          location: event?.location?.coords,
        });
      },
      onSchedule: (event) => {
        locationLogger.info("Schedule", {
          state: event?.state,
        });
      },
      onMotionChange: (event) => {
        // Diagnostic snapshot to understand periodic motion-change loops (eg Android ~5min).
        // Keep it cheap: avoid heavy calls unless motion-change fires.
        // NOTE: This is safe to run in background because it does not request a new location.
        locationLogger.info("Motion change", {
          isMoving: event?.isMoving,
          location: event?.location?.coords,
        });

        // Async snapshot of BGGeo internal state/config at the time of motion-change.
        // This helps correlate native behavior with our current profile + config.
        (async () => {
          try {
            const state = await BackgroundGeolocation.getState();

            locationLogger.info("Motion change diagnostic", {
              isMoving: event?.isMoving,
              appState: appState,
              profile: currentProfile,
              authReady,
              // Time correlation
              at: new Date().toISOString(),
              // Core BGGeo runtime state
              enabled: state?.enabled,
              trackingMode: state?.trackingMode,
              isMovingState: state?.isMoving,
              schedulerEnabled: state?.schedulerEnabled,
              // Critical config knobs related to periodic updates
              distanceFilter: state?.geolocation?.distanceFilter,
              heartbeatInterval: state?.app?.heartbeatInterval,
              motionTriggerDelay: state?.activity?.motionTriggerDelay,
              disableMotionActivityUpdates:
                state?.activity?.disableMotionActivityUpdates,
              stopTimeout: state?.geolocation?.stopTimeout,
              // Location quality signal
              accuracy: event?.location?.coords?.accuracy,
              speed: event?.location?.coords?.speed,
            });
          } catch (e) {
            locationLogger.warn("Motion change diagnostic failed", {
              error: e?.message,
            });
          }
        })();

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
                const fix = await BackgroundGeolocation.getCurrentPosition({
                  samples: 1,
                  persist: true,
                  timeout: 30,
                  maximumAge: 0,
                  desiredAccuracy: 50,
                  extras: {
                    moving_edge: true,
                  },
                });
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
      },
      onActivityChange: (event) => {
        locationLogger.info("Activity change", {
          activity: event?.activity,
          confidence: event?.confidence,
        });
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
        locationLogger.info("Connectivity change", {
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
        await BackgroundGeolocation.setConfig(BASE_GEOLOCATION_INVARIANTS);
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
