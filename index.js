// debug
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

// setup notification, this have to stay in index.js
notifee.onBackgroundEvent(notificationBackgroundEvent);
messaging().setBackgroundMessageHandler(onMessageReceived);

// Android Headless Mode for react-native-background-geolocation.
// Required because [`enableHeadless`](src/location/backgroundGeolocationConfig.js:16) is enabled and
// we run with [`stopOnTerminate: false`](src/location/backgroundGeolocationConfig.js:40).
//
// IMPORTANT: keep this handler lightweight. In headless state, the JS runtime may be launched
// briefly and then torn down; long tasks can be terminated by the OS.
BackgroundGeolocation.registerHeadlessTask(async (event) => {
  // eslint-disable-next-line no-console
  console.log("[BGGeo HeadlessTask]", event?.name, event?.params);
});

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
