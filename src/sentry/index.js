import * as Sentry from "@sentry/react-native";
import "@sentry/tracing";
import { Platform } from "react-native";

import env from "~/env";
import packageJson from "../../package.json";

// Get the build number from native code
const getBuildNumber = () => {
  if (Platform.OS === "ios") {
    // Use the same format as ios-archive.sh
    return packageJson.customExpoVersioning?.buildNumber || "0";
  }
  return packageJson.customExpoVersioning?.versionCode || "0";
};

// Construct release name in the same format as ios-archive.sh
const getReleaseVersion = () => {
  const version = packageJson.version;
  const buildNumber = getBuildNumber();
  if (Platform.OS === "ios") {
    return `com.alertesecours.alertesecours@${version}+${buildNumber}`;
  }
  return `com.alertesecours@${version}+${buildNumber}`;
};

Sentry.init({
  dsn: env.SENTRY_DSN,
  tracesSampleRate: 1.0,
  debug: __DEV__,
  // Configure release to match ios-archive.sh format
  release: getReleaseVersion(),
  // Use BUILD_TIME from env to match the value used in sourcemap upload
  dist: env.BUILD_TIME,
  enableNative: true,
  attachStacktrace: true,
  environment: __DEV__ ? "development" : "production",
  normalizeDepth: 10,
  maxBreadcrumbs: 100,
  // Enable debug ID tracking
  _experiments: {
    debugIds: true,
  },
  beforeSend(event) {
    event.extra = {
      ...event.extra,
      jsEngine: global.HermesInternal ? "hermes" : "jsc",
      hermesEnabled: !!global.HermesInternal,
      version: packageJson.version,
      buildNumber: getBuildNumber(),
      buildTime: env.BUILD_TIME,
    };

    if (event.exception) {
      event.exception.values = event.exception.values?.map((value) => ({
        ...value,
        mechanism: {
          ...value.mechanism,
          handled: true,
          synthetic: false,
          type: "hermes",
        },
      }));
    }

    return event;
  },
  beforeBreadcrumb(breadcrumb) {
    if (breadcrumb.category === "console") {
      return breadcrumb;
    }
    return breadcrumb;
  },
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
  integrations: [
    Sentry.mobileReplayIntegration({
      maskAllText: false,
      maskAllImages: false,
      maskAllVectors: false,
    }),
  ],
});
