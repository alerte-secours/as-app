// debug
import "./wdyr"; // <--- first import
import "./warnFilter";

import "expo-splash-screen";
import BackgroundGeolocation from "react-native-background-geolocation";

import notifee from "@notifee/react-native";
import messaging from "@react-native-firebase/messaging";

import "~/sentry";

import { registerRootComponent } from "expo";

import App from "~/app";

import { onBackgroundEvent as notificationBackgroundEvent } from "~/notifications/onEvent";
import onMessageReceived from "~/notifications/onMessageReceived";

import { createLogger } from "~/lib/logger";

// setup notification, this have to stay in index.js
notifee.onBackgroundEvent(notificationBackgroundEvent);
messaging().setBackgroundMessageHandler(onMessageReceived);

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

// this have to stay in index.js, see also https://github.com/transistorsoft/react-native-background-geolocation/wiki/Android-Headless-Mode
const getCurrentPosition = () => {
  return new Promise((resolve) => {
    BackgroundGeolocation.getCurrentPosition(
      {
        samples: 1,
        persist: true,
        extras: { background: true },
      },
      (location) => {
        resolve(location);
      },
      (error) => {
        resolve(error);
      },
    );
  });
};

const FORCE_SYNC_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
let lastSyncTime = Date.now();

const geolocBgLogger = createLogger({
  service: "background-geolocation",
  task: "headless",
});

const HeadlessTask = async (event) => {
  const { name, params } = event;
  geolocBgLogger.info("HeadlessTask event received", { name, params });

  try {
    switch (name) {
      case "heartbeat":
        // Check if we need to force a sync
        const now = Date.now();
        const timeSinceLastSync = now - lastSyncTime;

        const location = await getCurrentPosition();
        geolocBgLogger.debug("getCurrentPosition result", { location });

        if (timeSinceLastSync >= FORCE_SYNC_INTERVAL) {
          geolocBgLogger.info("Forcing location sync after 24h");
          // Update last sync time after successful sync
          await BackgroundGeolocation.changePace(true);
          await BackgroundGeolocation.sync();
          lastSyncTime = now;
        }
        break;
      case "location":
        geolocBgLogger.debug("Location update received", {
          location: params.location,
        });
        break;
      case "http":
        geolocBgLogger.debug("HTTP response received", {
          response: params.response,
        });
        // Update last sync time on successful HTTP response
        if (params.response?.status === 200) {
          lastSyncTime = Date.now();
        }
        break;
    }
  } catch (error) {
    geolocBgLogger.error("HeadlessTask error", { error });
  }
};

BackgroundGeolocation.registerHeadlessTask(HeadlessTask);
