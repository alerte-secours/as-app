import { createAtom } from "~/lib/atomic-zustand";
import { secureStore } from "~/lib/secureStore";

export default createAtom(({ merge, reset }) => {
  const setFcmToken = (token) => {
    merge({
      fcmToken: token,
    });
  };

  const setFcmTokenStored = ({ fcmToken, deviceId }) => {
    secureStore.setItemAsync("fcmTokenStored", fcmToken);
    secureStore.setItemAsync("fcmTokenStoredDeviceId", deviceId.toString());
    merge({
      fcmTokenStored: fcmToken,
      deviceId,
    });
  };

  const init = async () => {
    const fcmTokenStored = await secureStore.getItemAsync("fcmTokenStored");
    const fcmTokenStoredDeviceId = await secureStore.getItemAsync(
      "fcmTokenStoredDeviceId",
    );
    const deviceId = fcmTokenStoredDeviceId
      ? parseInt(fcmTokenStoredDeviceId, 10)
      : null;
    merge({
      fcmTokenStored: fcmTokenStored || false,
      deviceId,
    });
  };

  return {
    default: {
      fcmToken: null,
      fcmTokenStored: null,
      deviceId: null,
    },
    actions: {
      init,
      reset,
      setFcmToken,
      setFcmTokenStored,
    },
  };
});
