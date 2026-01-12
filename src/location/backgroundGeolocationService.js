import BackgroundGeolocation from "react-native-background-geolocation";
import { createLogger } from "~/lib/logger";
import { BACKGROUND_SCOPES } from "~/lib/logger/scopes";

import { BASE_GEOLOCATION_CONFIG } from "./backgroundGeolocationConfig";

const bgGeoLogger = createLogger({
  module: BACKGROUND_SCOPES.GEOLOCATION,
  feature: "bg-geo-service",
});

let readyPromise = null;
let lastReadyState = null;

let subscriptions = [];
let handlersSignature = null;

export async function ensureBackgroundGeolocationReady(
  config = BASE_GEOLOCATION_CONFIG,
) {
  if (readyPromise) return readyPromise;

  readyPromise = (async () => {
    bgGeoLogger.info("Calling BackgroundGeolocation.ready");
    const state = await BackgroundGeolocation.ready(config);
    lastReadyState = state;
    bgGeoLogger.info("BackgroundGeolocation is ready", {
      enabled: state?.enabled,
      isMoving: state?.isMoving,
      trackingMode: state?.trackingMode,
      schedulerEnabled: state?.schedulerEnabled,
    });
    return state;
  })().catch((error) => {
    // Allow retry if ready fails.
    readyPromise = null;
    lastReadyState = null;
    bgGeoLogger.error("BackgroundGeolocation.ready failed", {
      error: error?.message,
      stack: error?.stack,
      code: error?.code,
    });
    throw error;
  });

  return readyPromise;
}

export function getLastReadyState() {
  return lastReadyState;
}

export function setBackgroundGeolocationEventHandlers({
  onLocation,
  onLocationError,
  onHttp,
} = {}) {
  // Avoid duplicate registration when `trackLocation()` is called multiple times.
  // We use a simple signature so calling with identical functions is a no-op.
  const sig = `${onLocation ? "L1" : "L0"}-${onHttp ? "H1" : "H0"}`;
  if (handlersSignature === sig && subscriptions.length) {
    return;
  }

  subscriptions.forEach((s) => s?.remove?.());
  subscriptions = [];

  if (onLocation) {
    subscriptions.push(
      BackgroundGeolocation.onLocation(onLocation, onLocationError),
    );
  }
  if (onHttp) {
    subscriptions.push(BackgroundGeolocation.onHttp(onHttp));
  }

  handlersSignature = sig;
}

export async function stopBackgroundGeolocation() {
  await ensureBackgroundGeolocationReady();
  return BackgroundGeolocation.stop();
}

export async function startBackgroundGeolocation() {
  await ensureBackgroundGeolocationReady();
  return BackgroundGeolocation.start();
}
