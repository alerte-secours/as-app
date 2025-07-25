// debug
import "./wdyr"; // <--- first import
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
}
