import { useEffect, useRef } from "react";
import { useNetworkState, networkActions } from "~/stores";
import network from "~/network";
import { createLogger } from "~/lib/logger";
import { NETWORK_SCOPES } from "~/lib/logger/scopes";

const watchdogLogger = createLogger({
  module: NETWORK_SCOPES.WEBSOCKET,
  feature: "watchdog",
});

const HEARTBEAT_STALE_MS = 45_000;
const CHECK_EVERY_MS = 10_000;
const MIN_RESTART_INTERVAL_MS = 30_000;

export default function useWsWatchdog({ enabled = true } = {}) {
  const { wsConnected, wsLastHeartbeatDate, hasInternetConnection } =
    useNetworkState([
      "wsConnected",
      "wsLastHeartbeatDate",
      "hasInternetConnection",
    ]);

  const lastRestartRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;

    const interval = setInterval(() => {
      if (!hasInternetConnection) return;
      if (!wsConnected) return;
      if (!wsLastHeartbeatDate) return;

      const last = Date.parse(wsLastHeartbeatDate);
      if (!Number.isFinite(last)) return;

      const age = Date.now() - last;
      if (age < HEARTBEAT_STALE_MS) return;

      const now = Date.now();
      if (now - lastRestartRef.current < MIN_RESTART_INTERVAL_MS) return;
      lastRestartRef.current = now;

      watchdogLogger.warn("WS heartbeat stale, triggering recovery", {
        ageMs: age,
        lastHeartbeatDate: wsLastHeartbeatDate,
      });

      try {
        // First line recovery: restart websocket transport
        network.apolloClient?.restartWS?.();
      } catch (error) {
        watchdogLogger.error("WS restart failed", { error });
      }

      // Second line recovery: if WS stays stale, do a full client reload
      setTimeout(() => {
        const last2 = Date.parse(wsLastHeartbeatDate);
        const age2 = Number.isFinite(last2) ? Date.now() - last2 : Infinity;
        if (age2 >= HEARTBEAT_STALE_MS) {
          watchdogLogger.warn(
            "WS still stale after restart, triggering reload",
            {
              ageMs: age2,
            },
          );
          networkActions.triggerReload();
        }
      }, 10_000);
    }, CHECK_EVERY_MS);

    return () => clearInterval(interval);
  }, [enabled, hasInternetConnection, wsConnected, wsLastHeartbeatDate]);
}
