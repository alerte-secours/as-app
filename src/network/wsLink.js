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
  const MAX_RECONNECT_DELAY = 30000; // 30 seconds max delay
  // const MAX_RECONNECT_ATTEMPTS = 5; // Limit reconnection attempts
  const MAX_RECONNECT_ATTEMPTS = Infinity; // Limit reconnection attempts

  let reconnectAttempts = 0;
  function getReconnectDelay() {
    // Exponential backoff with max delay
    const delay = Math.min(
      1000 * Math.pow(2, reconnectAttempts),
      MAX_RECONNECT_DELAY,
    );
    return delay * (0.5 + Math.random()); // Add jitter
  }

  let reconnectTimeout;
  function scheduleReconnect() {
    // Clear any existing reconnect attempts
    clearTimeout(reconnectTimeout);

    // Schedule a single reconnect attempt with exponential backoff
    reconnectTimeout = setTimeout(() => {
      try {
        wsLogger.debug("Attempting scheduled reconnect", {
          attempt: reconnectAttempts + 1,
          delay: getReconnectDelay(),
        });
        wsLink.client.restart();
      } catch (error) {
        wsLogger.error("Failed to reconnect", { error });
      }
      reconnectTimeout = null;
    }, getReconnectDelay());
  }

  function cancelReconnect() {
    if (reconnectTimeout) {
      wsLogger.debug("Canceling scheduled reconnect");
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }
  }

  const wsLink = new WebSocketLink({
    url: GRAPHQL_WS_URL,
    connectionParams: () => {
      const { userToken } = getAuthState();
      const headers = {
        "Sec-WebSocket-Protocol": "graphql-transport-ws",
      };
      setBearerHeader(headers, userToken);
      return { headers };
    },
    keepAlive: PING_INTERVAL,
    retryAttempts: MAX_RECONNECT_ATTEMPTS,
    retryWait: async () => {
      const delay = getReconnectDelay();
      await new Promise((resolve) => setTimeout(resolve, delay));
    },
    shouldRetry: () => true,
    lazy: true,
    on: {
      connected: (socket) => {
        wsLogger.info("WebSocket connected");
        activeSocket = socket;
        reconnectAttempts = 0; // Reset attempts on successful connection
        networkActions.WSConnected();
        cancelReconnect(); // Cancel any pending reconnects

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

        // Schedule reconnect unless explicitly closed (1000) or going away (1001)
        if (event.code !== 1000 && event.code !== 1001) {
          reconnectAttempts++;
          scheduleReconnect();
        } else {
          wsLogger.debug("Clean WebSocket closure - not reconnecting");
        }
      },
      ping: (received) => {
        // wsLogger.debug("WebSocket ping", { received });
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
        if (received) {
          clearTimeout(pingTimeout); // pong is received, clear connection close timeout
        }
      },
    },
  });

  return wsLink;
}
