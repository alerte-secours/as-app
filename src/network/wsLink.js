import { setBearerHeader } from "./headers";
import WebSocketLink from "./WebSocketLink";
import { networkActions } from "~/stores";
import { createLogger } from "~/lib/logger";
import { NETWORK_SCOPES } from "~/lib/logger/scopes";

export default function createWsLink({ store, GRAPHQL_WS_URL }) {
  const { getAuthState } = store;
  const wsLogger = createLogger({
    module: NETWORK_SCOPES.WEBSOCKET,
    service: "graphql",
  });

  let activeSocket, pingTimeout;

  const PING_INTERVAL = 10_000;
  const PING_TIMEOUT = 5_000;

  // Let `graphql-ws` manage reconnection.
  // Our own reconnect scheduling was causing overlapping connection attempts
  // and intermittent RN Android `client is null` (send called on already-closed native socket).
  const MAX_RECONNECT_ATTEMPTS = Infinity;

  const wsLink = new WebSocketLink({
    url: GRAPHQL_WS_URL,
    connectionParams: () => {
      const { userToken } = getAuthState();
      const headers = {};

      // Important: only attach Authorization when we have a real token.
      // Sending `Authorization: Bearer undefined` breaks WS auth on some backends.
      if (userToken) {
        setBearerHeader(headers, userToken);
      } else {
        wsLogger.warn("WS connectionParams without userToken", {
          url: GRAPHQL_WS_URL,
        });
      }

      // Note: Sec-WebSocket-Protocol is negotiated at the handshake level.
      // Putting it in `connection_init.payload.headers` is ineffective and can
      // confuse server-side auth header parsing.
      return { headers };
    },
    // Do not use lazy sockets: some RN Android builds intermittently hit
    // WebSocketModule send() with null client when the socket is created/
    // torn down rapidly around app-state transitions.
    lazy: false,
    keepAlive: PING_INTERVAL,
    retryAttempts: MAX_RECONNECT_ATTEMPTS,
    retryWait: async () => {
      // `graphql-ws` passes the retry count to `retryWait(retries)`.
      // Use a jittered exponential backoff, capped.
      const retries = arguments[0] ?? 0;
      const base = Math.min(1000 * Math.pow(2, retries), 30_000);
      const delay = base * (0.5 + Math.random());
      await new Promise((resolve) => setTimeout(resolve, delay));
    },
    shouldRetry: () => true,
    on: {
      opened: () => {
        wsLogger.info("WebSocket opened", {
          url: GRAPHQL_WS_URL,
        });
      },
      connected: (socket) => {
        wsLogger.info("WebSocket connected");
        activeSocket = socket;
        networkActions.WSConnected();
        networkActions.WSTouch();

        // Clear any lingering ping timeouts
        if (pingTimeout) {
          clearTimeout(pingTimeout);
          pingTimeout = null;
        }
      },
      closed: (event) => {
        wsLogger.info("WebSocket closed", {
          code: event.code,
          reason: event.reason || "No reason provided",
          wasClean: event.wasClean,
        });
        networkActions.WSClosed();

        // Clear socket and timeouts
        activeSocket = undefined;
        if (pingTimeout) {
          clearTimeout(pingTimeout);
          pingTimeout = null;
        }
      },
      ping: (received) => {
        // wsLogger.debug("WebSocket ping", { received });
        networkActions.WSTouch();
        if (!received) {
          // Clear any existing ping timeout
          if (pingTimeout) {
            clearTimeout(pingTimeout);
          }

          pingTimeout = setTimeout(() => {
            wsLogger.warn("WebSocket ping timeout");
            if (activeSocket?.readyState === WebSocket.OPEN) {
              wsLogger.error("WebSocket request timeout, closing connection");
              try {
                activeSocket.close(4408, "Request Timeout");
              } catch (error) {
                wsLogger.error("Error closing WebSocket on ping timeout", {
                  error,
                });
              }
            }
            pingTimeout = null;
          }, PING_TIMEOUT);
        }
      },
      pong: (received) => {
        // wsLogger.debug("WebSocket pong", { received });
        networkActions.WSTouch();
        if (received) {
          clearTimeout(pingTimeout); // pong is received, clear connection close timeout
        }
      },
      error: (error) => {
        wsLogger.error("WebSocket error", {
          message: error?.message,
          url: GRAPHQL_WS_URL,
        });
      },
    },
  });

  return wsLink;
}
