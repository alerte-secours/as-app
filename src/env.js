import { Platform } from "react-native";

// Logging configuration
const LOG_SCOPES = process.env.APP_LOG_SCOPES;
const LOG_MIN_LEVEL = process.env.APP_LOG_MIN_LEVEL;

const LOCAL_DEV = process.env.LOCAL_DEV !== "false" ? true : false;

const BEARER_COOKIE_NAME = "bearer";
const BEARER_USE_COOKIE = false;

// Helper function to get the correct development host based on platform
const getDevelopmentHost = () => {
  if (Platform.OS === "ios") {
    return "localhost";
  }
  // Android uses 10.0.2.2 to access host machine's localhost
  return "10.0.2.2";
};

const DEV_HOST = getDevelopmentHost();

const OA_FILES_URL =
  process.env.APP_OA_FILES_URL || `http://${DEV_HOST}:4292/api/v1/oas`;

const MINIO_URL = process.env.APP_MINIO_URL || `http://${DEV_HOST}:4290`;

const GRAPHQL_URL =
  process.env.APP_GRAPHQL_URL || `http://${DEV_HOST}:4201/v1/graphql`;

const GRAPHQL_WS_URL =
  process.env.APP_GRAPHQL_WS_URL || `ws://${DEV_HOST}:4201/v1/graphql`;

const GEOLOC_SYNC_URL =
  process.env.APP_GEOLOC_SYNC_URL ||
  `http://${DEV_HOST}:4200/api/v1/oas/geoloc/sync`;

const OSRM_CAR_URL = process.env.APP_OSRM_CAR_URL || `http://${DEV_HOST}:4261`;
const OSRM_FOOT_URL =
  process.env.APP_OSRM_FOOT_URL || `http://${DEV_HOST}:4262`;
const OSRM_BICYCLE_URL =
  process.env.APP_OSRM_BICYCLE_URL || `http://${DEV_HOST}:4263`;

const CLAIMS_NAMESPACE =
  process.env.CLAIMS_NAMESPACE || "https://alertesecours.fr/claims";

const MAPVIEW_STYLE_URL =
  process.env.APP_MAPVIEW_STYLE_URL || `http://${DEV_HOST}:4203/app/style.json`;
const MAPVIEW_DARK_STYLE_URL =
  process.env.APP_MAPVIEW_DARK_STYLE_URL ||
  `http://${DEV_HOST}:4203/app/dark-matter/style.json`;

const SENTRY_DSN = process.env.SENTRY_DSN;

const BUILD_TIME = process.env.BUILD_TIME;

const envMap = {
  LOG_SCOPES,
  LOG_MIN_LEVEL,
  LOCAL_DEV,
  BEARER_COOKIE_NAME,
  BEARER_USE_COOKIE,
  OA_FILES_URL,
  MINIO_URL,
  GRAPHQL_URL,
  GRAPHQL_WS_URL,
  GEOLOC_SYNC_URL,
  OSRM_CAR_URL,
  OSRM_FOOT_URL,
  OSRM_BICYCLE_URL,
  CLAIMS_NAMESPACE,
  MAPVIEW_STYLE_URL,
  MAPVIEW_DARK_STYLE_URL,
  SENTRY_DSN,
  BUILD_TIME,
  IS_STAGING: false,
};

const stagingMap = {
  MINIO_URL: process.env.STAGING_APP_MINIO_URL || MINIO_URL,
  OA_FILES_URL: process.env.STAGING_APP_OA_FILES_URL || OA_FILES_URL,
  GRAPHQL_URL: process.env.STAGING_APP_GRAPHQL_URL || GRAPHQL_URL,
  GRAPHQL_WS_URL: process.env.STAGING_APP_GRAPHQL_WS_URL || GRAPHQL_WS_URL,
  GEOLOC_SYNC_URL: process.env.STAGING_APP_GEOLOC_SYNC_URL || GEOLOC_SYNC_URL,
  IS_STAGING: true,
};

export const setStaging = (enabled) => {
  for (const key of Object.keys(env)) {
    if (stagingMap[key] !== undefined) {
      env[key] = enabled ? stagingMap[key] : envMap[key];
    }
  }
};

const env = { ...envMap };

export default env;

// +1
