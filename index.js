// debug
import "./warnFilter";

import "expo-splash-screen";
import BackgroundGeolocation from "react-native-background-geolocation";

import { Platform } from "react-native";

import notifee from "@notifee/react-native";
import messaging from "@react-native-firebase/messaging";

import "~/sentry";

import { registerRootComponent } from "expo";

import App from "~/app";

import { onBackgroundEvent as notificationBackgroundEvent } from "~/notifications/onEvent";
import onMessageReceived from "~/notifications/onMessageReceived";

import { createLogger } from "~/lib/logger";
// import { executeHeartbeatSync } from "~/location/backgroundTask";

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

// Android Headless Task entrypoint.
// This is required for reliable delivery of events when the app process is terminated.
// We keep it lightweight and focus on ensuring queued locations are flushed.
const HeadlessTask = async (event) => {
  try {
    const name = event?.name;
    geolocBgLogger.info("HeadlessTask event", { name });

    switch (name) {
      case "location":
      case "heartbeat":
      case "connectivitychange":
        // Attempt to flush any queued locations.
        await BackgroundGeolocation.sync();
        break;
      default:
        break;
    }
  } catch (error) {
    geolocBgLogger.error("HeadlessTask error", {
      error: error?.message,
      stack: error?.stack,
      event,
    });
  }
};

if (Platform.OS === "android") {
  BackgroundGeolocation.registerHeadlessTask(HeadlessTask);
}
