import { createLogger } from "~/lib/logger";
import { BACKGROUND_SCOPES } from "~/lib/logger/scopes";
import * as Sentry from "@sentry/react-native";
import BackgroundGeolocation from "react-native-background-geolocation";
import throttle from "lodash.throttle";

import { authActions, getAuthState } from "~/stores";
import { setLastSyncTime } from "~/lib/geolocation/syncTimeManager";

// Create logger for HTTP response handling
const httpLogger = createLogger({
  module: BACKGROUND_SCOPES.GEOLOCATION,
  feature: "http-handler",
});

// Throttling configuration for auth reload
const AUTH_RELOAD_THROTTLE = 5000; // 5 seconds throttle

// The core auth reload function that will be throttled
async function _reloadAuth() {
  httpLogger.info("Refreshing authentication token via sync endpoint");

  try {
    // Get current auth state to check if we have an auth token
    const { authToken, userToken } = getAuthState();

    if (!authToken) {
      httpLogger.warn("No auth token available for refresh");
      return;
    }

    httpLogger.debug(
      "Auth token available, updating BackgroundGeolocation config",
    );

    // Update BackgroundGeolocation config to include X-Auth-Token header
    await BackgroundGeolocation.setConfig({
      headers: {
        Authorization: `Bearer ${userToken}`, // Keep existing user token (may be expired)
        "X-Auth-Token": authToken, // Add auth token for refresh
      },
    });

    // Trigger sync to refresh token
    await BackgroundGeolocation.changePace(true);
    await BackgroundGeolocation.sync();

    httpLogger.info("Token refresh sync triggered successfully");
  } catch (error) {
    httpLogger.error("Failed to refresh authentication token", {
      error: error.message,
      stack: error.stack,
    });
  }
}

// Create throttled version of auth reload with lodash
const reloadAuth = throttle(_reloadAuth, AUTH_RELOAD_THROTTLE, {
  leading: true,
  trailing: false, // Prevent trailing calls to avoid duplicate refreshes
});

/**
 * Shared HTTP response handler for both foreground and headless contexts
 * @param {Object} response - The HTTP response object from BackgroundGeolocation
 * @param {string} context - Either 'foreground' or 'headless'
 */
export const handleHttpResponse = async (response, context = "foreground") => {
  // Log the full response including headers if available
  httpLogger.debug("HTTP response received", {
    status: response?.status,
    success: response?.success,
    responseText: response?.responseText,
    url: response?.url,
    method: response?.method,
    isSync: response?.isSync,
    context,
    requestHeaders:
      response?.request?.headers || "Headers not available in response",
  });

  // Add Sentry breadcrumb for HTTP responses
  Sentry.addBreadcrumb({
    message: `Background geolocation HTTP response (${context})`,
    category: "geolocation-http",
    level: response?.status === 200 ? "info" : "warning",
    data: {
      status: response?.status,
      success: response?.success,
      url: response?.url,
      isSync: response?.isSync,
      recordCount: response?.count,
      context,
    },
  });

  const statusCode = response?.status;

  // Log status code and response
  httpLogger.debug("Processing HTTP response", {
    status: statusCode,
    responseText: response?.responseText,
    context,
  });

  switch (statusCode) {
    case 200:
      await handleSuccessResponse(response, context);
      break;
    case 410:
      await handleAuthTokenNotFound(response, context);
      break;
    case 401:
      await handleUnauthorized(response, context);
      break;
    default:
      httpLogger.debug("Unhandled HTTP status code", {
        status: statusCode,
        context,
      });
  }
};

/**
 * Handle successful HTTP response (status 200)
 */
const handleSuccessResponse = async (response, context) => {
  try {
    const responseBody = response?.responseText
      ? JSON.parse(response.responseText)
      : null;

    if (responseBody?.userBearerJwt) {
      httpLogger.info("Token refresh successful, updating stored token", {
        context,
      });

      // Use auth action to update both in-memory and persistent storage
      await authActions.setUserToken(responseBody.userBearerJwt);

      // Update BackgroundGeolocation config with new token and remove X-Auth-Token header
      await BackgroundGeolocation.setConfig({
        headers: {
          Authorization: `Bearer ${responseBody.userBearerJwt}`,
        },
      });

      httpLogger.debug(
        "Updated BackgroundGeolocation with refreshed token and removed X-Auth-Token header",
        { context },
      );

      Sentry.addBreadcrumb({
        message: "Token refreshed successfully",
        category: "geolocation-auth",
        level: "info",
        data: { context },
      });
    }
  } catch (e) {
    httpLogger.debug("Failed to parse successful response", {
      error: e.message,
      responseText: response?.responseText,
      context,
    });
  }
};

/**
 * Handle auth token expired (status 410)
 */
const handleAuthTokenNotFound = async (response, context) => {
  httpLogger.info("Auth token not found (410), logging out", { context });

  Sentry.addBreadcrumb({
    message: "Auth token expired - logging out",
    category: "geolocation-auth",
    level: "warning",
    data: { context },
  });

  authActions.logout();
};

/**
 * Handle unauthorized request (status 401)
 */
const handleUnauthorized = async (response, context) => {
  httpLogger.info("Unauthorized (401), attempting to refresh token", {
    context,
  });

  // Add more detailed logging of the error response
  try {
    const errorBody = response?.responseText
      ? JSON.parse(response.responseText)
      : null;

    httpLogger.debug("Unauthorized error details", {
      errorBody,
      errorType: errorBody?.error?.type,
      errorMessage: errorBody?.error?.message,
      errorPath: errorBody?.error?.errors?.[0]?.path,
      context,
    });

    Sentry.addBreadcrumb({
      message: "Unauthorized - refreshing token",
      category: "geolocation-auth",
      level: "warning",
      data: {
        errorType: errorBody?.error?.type,
        errorMessage: errorBody?.error?.message,
        context,
      },
    });
  } catch (e) {
    httpLogger.debug("Failed to parse error response", {
      error: e.message,
      responseText: response?.responseText,
      context,
    });
  }
  await reloadAuth();
};
