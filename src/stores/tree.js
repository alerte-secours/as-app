import { createAtom } from "~/lib/atomic-zustand";

const reloadCallbacks = [];

export default createAtom(({ merge, getActions }) => {
  const sessionActions = getActions("session");
  const networkActions = getActions("network");

  const alertActions = getActions("alert");
  const navActions = getActions("alert");
  const fcmActions = getActions("fcm");
  const paramsActions = getActions("params");
  const notificationsActions = getActions("notifications");

  const resetStores = () => {
    navActions.reset();
    paramsActions.reset();
    fcmActions.reset();
    alertActions.reset();
    notificationsActions.reset();
  };

  const triggerReload = (callback) => {
    if (callback) {
      reloadCallbacks.push(callback);
    }
    networkActions.triggerReload();
    sessionActions.clear();
    resetStores();
    merge({
      triggerReload: true,
      suspend: false,
    });
  };

  const onReload = async () => {
    merge({
      triggerReload: false,
    });
    while (reloadCallbacks.length > 0) {
      let callback = reloadCallbacks.shift();
      if (callback) {
        callback();
      }
    }
  };

  const suspendTree = () => {
    merge({ suspend: true });
  };

  const splashScreenHidden = () => {
    merge({ splashScreenHidden: true });
  };

  return {
    default: {
      triggerReload: false,
      suspend: false,
      splashScreenHidden: false,
    },
    actions: {
      triggerReload,
      suspendTree,
      onReload,
      splashScreenHidden,
    },
  };
});
