// debug
import "./wdyr"; // <--- first import
import "./warnFilter";

import "expo-splash-screen";
import { Platform } from "react-native";
import BackgroundGeolocation from "react-native-background-geolocation";
import BackgroundFetch from "react-native-background-fetch";

import notifee from "@notifee/react-native";
import messaging from "@react-native-firebase/messaging";

import "~/sentry";

import { registerRootComponent } from "expo";

import App from "~/app";

import { onBackgroundEvent as notificationBackgroundEvent } from "~/notifications/onEvent";
import onMessageReceived from "~/notifications/onMessageReceived";

import { executeHeartbeatSync } from "~/location/backgroundTask";

// setup notification, this have to stay in index.js
notifee.onBackgroundEvent(notificationBackgroundEvent);
messaging().setBackgroundMessageHandler(onMessageReceived);

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

// Android: Full BackgroundGeolocation headless task handler
const androidHeadlessTask = async (event) => {
  try {
    const { name } = event;

    if (name === "heartbeat") {
      await executeHeartbeatSync();
    }
  } catch (error) {
    // silent error
  }
};

// iOS: Simple BackgroundFetch headless task handler
const iosBackgroundFetchTask = async (event) => {
  const taskId = event?.taskId;
  let syncResult = null;

  try {
    if (!taskId) {
      throw new Error("No taskId provided in iOS BackgroundFetch event");
    }

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
        } else if (syncResult?.syncPerformed && syncResult?.syncSuccessful) {
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
};

// Platform-specific background task registration
// BackgroundGeolocation.registerHeadlessTask only works on Android
// For iOS, we must rely on BackgroundFetch
if (Platform.OS === "android") {
  // Android: Use BackgroundGeolocation headless task with full event handling
  // BackgroundGeolocation already provides comprehensive background task handling for Android
  BackgroundGeolocation.registerHeadlessTask(androidHeadlessTask);
} else if (Platform.OS === "ios") {
  // iOS: Use BackgroundFetch with both headless task and configure callback
  // - registerHeadlessTask: handles when app is completely terminated
  // - configure callback: handles when app is backgrounded but still running
  // Both are needed to work in all situations
  BackgroundFetch.registerHeadlessTask(iosBackgroundFetchTask);

  // Configure BackgroundFetch for iOS (iOS-specific configuration)
  BackgroundFetch.configure(
    {
      minimumFetchInterval: 15, // Only valid option for iOS - gives best chance of execution
      // Note: stopOnTerminate, startOnBoot, forceAlarmManager are Android-only and don't work on iOS
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
