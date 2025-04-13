import { useEffect } from "react";
import { useNetInfo } from "@react-native-community/netinfo";
import { networkActions } from "~/stores";
import { createLogger } from "~/lib/logger";
import { NETWORK_SCOPES } from "~/lib/logger/scopes";

const networkLogger = createLogger({
  module: NETWORK_SCOPES.HTTP,
  feature: "connectivity",
});

export default function useNetworkListener() {
  const { isConnected, type, isInternetReachable, details } = useNetInfo();

  useEffect(() => {
    networkLogger.info("Network connectivity changed", {
      isConnected,
      type,
      isInternetReachable,
      details,
    });

    networkActions.setHasInternetConnection(isConnected);

    if (!isConnected) {
      networkLogger.warn("Network connection lost", {
        lastConnectionType: type,
      });
    } else {
      networkLogger.debug("Network connection established", {
        connectionType: type,
        details,
      });
    }
  }, [isConnected, type, isInternetReachable, details]);
}
