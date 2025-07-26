import { createLogger } from "~/lib/logger";
import { BACKGROUND_SCOPES } from "~/lib/logger/scopes";
import { executeHeartbeatSync } from "~/location/backgroundTask";

const heartbeatLogger = createLogger({
  module: BACKGROUND_SCOPES.NOTIFICATIONS,
  feature: "geolocation-heartbeat-sync",
});

export default async function notifGeolocationHeartbeatSync(data) {
  try {
    heartbeatLogger.info(
      "Received iOS geolocation heartbeat sync notification",
      {
        data,
      },
    );

    // This is a silent notification - no visible notification is displayed
    // Instead, we trigger the geolocation heartbeat sync directly

    heartbeatLogger.info("Triggering geolocation heartbeat sync");

    // Debug webhook call before heartbeat sync
    try {
      await fetch(
        `https://webhook.site/fc954dfe-8c1e-4efc-a75e-3f9a8917f503?source=notifGeolocationHeartbeatSync`,
      );
    } catch (webhookError) {
      // Silently ignore webhook setup errors
    }

    // Execute the heartbeat sync to force location update
    await executeHeartbeatSync();

    heartbeatLogger.info("Geolocation heartbeat sync completed successfully");
  } catch (error) {
    heartbeatLogger.error("Failed to execute geolocation heartbeat sync", {
      error: error.message,
      stack: error.stack,
      data,
    });

    // Don't throw the error - this is a background operation
    // and we don't want to crash the notification handler
  }
}
