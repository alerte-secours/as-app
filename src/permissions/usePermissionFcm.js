import { usePermissionsState, permissionsActions } from "~/stores";
import { useEffect } from "react";

import requestPermissionFcm from "./requestPermissionFcm";

export default async function usePermissionFcm() {
  const { fcm } = usePermissionsState(["fcm"]);

  const { setFcm } = permissionsActions;

  useEffect(() => {
    // if (fcm) {
    //   return;
    // }
    (async () => {
      // const authStatus = await messaging().requestPermission();
      // setFcm(
      //   authStatus === AuthorizationStatus.AUTHORIZED ||
      //     authStatus === AuthorizationStatus.PROVISIONAL,
      // );
      const granted = await requestPermissionFcm();

      setFcm(granted);
    })();
  }, [fcm, setFcm]);

  return { ready: fcm };
}
