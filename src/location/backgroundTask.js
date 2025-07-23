import BackgroundGeolocation from "react-native-background-geolocation";

// Shared heartbeat logic - mutualized between Android and iOS
export const executeHeartbeatSync = async () => {
  let syncPerformed = false;
  let syncSuccessful = false;

  try {
    syncPerformed = true;

    try {
      // Change pace to ensure location updates
      // await BackgroundGeolocation.changePace(true);

      // Perform sync
      await BackgroundGeolocation.sync();
      /*
      await fetch("https://webhook.site/a917c208-9c1c-4e1b-b0e7-49a93b71db74", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: "Heartbeat sync from iOS",
          timestamp: new Date().toISOString(),
        }),
      });
      */

      syncSuccessful = true;
    } catch (syncError) {
      syncSuccessful = false;
    }

    // Return result information for BackgroundFetch
    return {
      syncPerformed,
      syncSuccessful,
    };
  } catch (error) {
    // Return error result for BackgroundFetch
    return {
      syncPerformed,
      syncSuccessful: false,
      error: error.message,
    };
  }
};
