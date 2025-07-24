// debug
import "./wdyr"; // <--- first import
import "./warnFilter";

import "expo-splash-screen";
import BackgroundGeolocation from "react-native-background-geolocation";

import { Platform } from "react-native";
import BackgroundFetch from "react-native-background-fetch";

import notifee from "@notifee/react-native";
import messaging from "@react-native-firebase/messaging";

import "~/sentry";

import { registerRootComponent } from "expo";

import App from "~/app";

import { onBackgroundEvent as notificationBackgroundEvent } from "~/notifications/onEvent";
import onMessageReceived from "~/notifications/onMessageReceived";

import { createLogger } from "~/lib/logger";
import { executeHeartbeatSync } from "~/location/backgroundTask";

// setup notification, this have to stay in index.js
notifee.onBackgroundEvent(notificationBackgroundEvent);
messaging().setBackgroundMessageHandler(onMessageReceived);

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

const geolocBgLogger = createLogger({
  service: "background-geolocation",
  task: "headless",
});

const HeadlessTask = async (event) => {
  try {
    switch (event?.name) {
      case "heartbeat":
        await executeHeartbeatSync();
        break;
      default:
        break;
    }
  } catch (error) {
    geolocBgLogger.error("HeadlessTask error", {
      error,
      event,
    });
  }
};

if (Platform.OS === "android") {
  BackgroundGeolocation.registerHeadlessTask(HeadlessTask);
} else if (Platform.OS === "ios") {
  BackgroundGeolocation.onLocation(async () => {
    await executeHeartbeatSync();
  });

  BackgroundGeolocation.onMotionChange(async () => {
    await executeHeartbeatSync();
  });

  // Configure BackgroundFetch for iOS (iOS-specific configuration)
  BackgroundFetch.configure(
    {
      minimumFetchInterval: 15, // Only valid option for iOS - gives best chance of execution
    },
    // Event callback
    async (taskId) => {
      let syncResult = null;

      try {
        // Execute the shared heartbeat logic and get result
        syncResult = await executeHeartbeatSync();
      } catch (error) {
        // silent error
      } finally {
        // CRITICAL: Always call finish with appropriate result
        try {
          if (taskId) {
            let fetchResult;

            if (syncResult?.error || !syncResult?.syncSuccessful) {
              // Task failed
              fetchResult = BackgroundFetch.FETCH_RESULT_FAILED;
            } else if (
              syncResult?.syncPerformed &&
              syncResult?.syncSuccessful
            ) {
              // Force sync was performed successfully - new data
              fetchResult = BackgroundFetch.FETCH_RESULT_NEW_DATA;
            } else {
              // No sync was needed - no new data
              fetchResult = BackgroundFetch.FETCH_RESULT_NO_DATA;
            }

            BackgroundFetch.finish(taskId, fetchResult);
          }
        } catch (finishError) {
          // silent error
        }
      }
    },
    // Timeout callback (REQUIRED by BackgroundFetch API)
    async (taskId) => {
      // CRITICAL: Must call finish on timeout with FAILED result
      BackgroundFetch.finish(taskId, BackgroundFetch.FETCH_RESULT_FAILED);
    },
  ).catch(() => {
    // silent error
  });
}
