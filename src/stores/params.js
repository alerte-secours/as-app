import { createAtom } from "~/lib/atomic-zustand";

export default createAtom(({ merge, reset }) => {
  const setDevModeEnabled = (b) => {
    merge({
      devModeEnabled: b,
    });
  };

  const setPreferredEmergencyCall = (preferredEmergencyCall) => {
    merge({
      preferredEmergencyCall,
    });
  };

  const setColorScheme = (colorScheme) => {
    merge({
      colorScheme,
    });
  };

  const setMapColorScheme = (mapColorScheme) => {
    merge({
      mapColorScheme,
    });
  };

  const setHasRegisteredRelatives = (hasRegisteredRelatives) => {
    merge({
      hasRegisteredRelatives,
    });
  };

  const setAlertListSortBy = (alertListSortBy) => {
    merge({
      alertListSortBy,
    });
  };

  return {
    default: {
      // devModeEnabled: false,
      devModeEnabled: __DEV__ || process.env.NODE_ENV !== "production",
      preferredEmergencyCall: "voice",
      colorScheme: "auto",
      mapColorScheme: "auto",
      hasRegisteredRelatives: null,
      alertListSortBy: "location",
    },
    actions: {
      reset,
      setDevModeEnabled,
      setPreferredEmergencyCall,
      setColorScheme,
      setMapColorScheme,
      setHasRegisteredRelatives,
      setAlertListSortBy,
    },
  };
});
