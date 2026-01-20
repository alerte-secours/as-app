import BackgroundGeolocation from "react-native-background-geolocation";
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
    let stopAlertSubscription = null;
    let stopSessionSubscription = null;

    // One-off startup refresh: when tracking is enabled at app launch, fetch a fresh fix once.
    // This follows Transistorsoft docs guidance to use getCurrentPosition rather than forcing
    // the SDK into moving mode with changePace(true).
    let didRequestStartupFix = false;
    let startupFixInFlight = null;

    // When auth changes, we want a fresh persisted point for the newly effective identity.
    // Debounced to avoid spamming `getCurrentPosition` if auth updates quickly (refresh/renew).
    let authFixDebounceTimerId = null;
    let authFixInFlight = null;
    const AUTH_FIX_DEBOUNCE_MS = 1500;

    const scheduleAuthFreshFix = () => {
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

          const location = await BackgroundGeolocation.getCurrentPosition({
            samples: 3,
            persist: true,
            timeout: 30,
            maximumAge: 5000,
            desiredAccuracy: 50,
            extras: {
              auth_token_update: true,
            },
          });

          locationLogger.info("Auth-change location fix acquired", {
            accuracy: location?.coords?.accuracy,
            latitude: location?.coords?.latitude,
            longitude: location?.coords?.longitude,
            timestamp: location?.timestamp,
          });
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
        desiredAccuracy: profile.desiredAccuracy,
        distanceFilter: profile.distanceFilter,
        heartbeatInterval: profile.heartbeatInterval,
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
      if (!userToken) {
        locationLogger.info("No auth token, stopping location tracking");

        // Prevent any further uploads before stopping.
        // This guards against persisted HTTP config continuing to flush queued records.
        try {
          await BackgroundGeolocation.setConfig({
            url: "",
            autoSync: false,
            headers: {},
          });
        } catch (e) {
          locationLogger.warn("Failed to clear BGGeo HTTP config on logout", {
            error: e?.message,
          });
        }

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

        if (authFixDebounceTimerId) {
          clearTimeout(authFixDebounceTimerId);
          authFixDebounceTimerId = null;
        }
        authFixInFlight = null;
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

      // Always request a fresh persisted point on any token update.
      // This ensures a newly connected user gets an immediate point even if they don't move.
      scheduleAuthFreshFix();

      // Request a single fresh location-fix on each app launch when tracking is enabled.
      // - We do this only after auth headers are configured so the persisted point can sync.
      // - We do NOT force moving mode.
      if (!didRequestStartupFix) {
        didRequestStartupFix = true;
        startupFixInFlight = scheduleAuthFreshFix();
      } else if (authFixInFlight) {
        // Avoid concurrent fix calls if auth updates race.
        await authFixInFlight;
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
        locationLogger.info("Motion change", {
          isMoving: event?.isMoving,
          location: event?.location?.coords,
        });
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
