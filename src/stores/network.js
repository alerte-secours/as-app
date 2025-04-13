import { createAtom } from "~/lib/atomic-zustand";

export default createAtom(({ merge, get }) => {
  return {
    default: {
      wsConnected: false,
      wsConnectedDate: null,
      wsClosedDate: null,
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
      setHasInternetConnection: (status) =>
        merge({ hasInternetConnection: status }),
    },
  };
});
