import { createAtom } from "~/lib/atomic-zustand";

export default createAtom(({ merge, get }) => {
  return {
    default: {
      wsConnected: false,
      wsConnectedDate: null,
      wsClosedDate: null,
      wsLastHeartbeatDate: null,
      wsLastRecoveryDate: null,
      triggerReload: false,
      initialized: true,
      hasInternetConnection: true,
    },
    actions: {
      triggerReload: () => {
        merge({
          initialized: false,
          triggerReload: true,
        });
      },
      onReload: () => {
        merge({
          initialized: true,
          triggerReload: false,
        });
      },
      WSConnected: () => {
        merge({
          wsConnected: true,
          wsConnectedDate: new Date().toISOString(),
          wsLastHeartbeatDate: new Date().toISOString(),
        });
      },
      WSClosed: () => {
        const wsConnected = get("wsConnected");
        if (!wsConnected) {
          // avoid trigger wsClosedDate update that could re-run in loop data subscriptions
          return;
        }
        merge({
          wsConnected: false,
          wsClosedDate: new Date().toISOString(),
        });
      },
      WSTouch: () => {
        // Update whenever we get any WS-level signal: connected, ping/pong, or a message.
        merge({
          wsLastHeartbeatDate: new Date().toISOString(),
        });
      },
      WSRecoveryTouch: () => {
        // Shared throttle marker to avoid multiple parts of the app triggering WS recovery
        // at the same time (watchdog + per-subscription liveness + lifecycle).
        merge({
          wsLastRecoveryDate: new Date().toISOString(),
        });
      },
      setHasInternetConnection: (status) =>
        merge({ hasInternetConnection: status }),
    },
  };
});
