import React, { useEffect, useCallback } from "react";
import {
  View,
  TouchableOpacity,
  StyleSheet,
  Platform,
  AppState,
} from "react-native";
import { Button, Title } from "react-native-paper";
import { usePermissionsState, permissionsActions } from "~/stores";
import { Ionicons } from "@expo/vector-icons";
import {
  requestBatteryOptimizationExemption,
  isBatteryOptimizationEnabled,
} from "~/lib/native/batteryOptimization";
import openSettings from "~/lib/native/openSettings";

import requestPermissionFcm from "~/permissions/requestPermissionFcm";
import requestPermissionLocationBackground from "~/permissions/requestPermissionLocationBackground";
import requestPermissionLocationForeground from "~/permissions/requestPermissionLocationForeground";
import requestPermissionReadContacts from "~/permissions/requestPermissionReadContacts";
import requestPermissionPhoneCall from "~/permissions/requestPermissionPhoneCall";
import requestPermissionMotion from "~/permissions/requestPermissionMotion";
import Text from "~/components/Text";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import * as Contacts from "expo-contacts";

const requestBatteryOptimizationDisable = async () => {
  if (Platform.OS !== "android") return true;

  try {
    const enabled = await isBatteryOptimizationEnabled();
    if (enabled) {
      console.log("Battery optimization enabled, requesting exemption...");
      await requestBatteryOptimizationExemption();
      // User must interact in Settings; will re-check on AppState 'active'
      return false;
    }
    console.log("Battery optimization already disabled");
    return true;
  } catch (error) {
    console.error("Error handling battery optimization:", error);
    return false;
  }
};

const requestPermissions = {
  fcm: requestPermissionFcm,
  locationBackground: requestPermissionLocationBackground,
  locationForeground: requestPermissionLocationForeground,
  readContacts: requestPermissionReadContacts,
  phoneCall: requestPermissionPhoneCall,
  motion: requestPermissionMotion.requestPermission,
  batteryOptimizationDisabled: requestBatteryOptimizationDisable,
};

const setPermissions = {
  fcm: (b) => permissionsActions.setFcm(b),
  locationBackground: (b) => permissionsActions.setLocationBackground(b),
  locationForeground: (b) => permissionsActions.setLocationForeground(b),
  readContacts: (b) => permissionsActions.setReadContacts(b),
  phoneCall: (b) => permissionsActions.setPhoneCall(b),
  motion: (b) => permissionsActions.setMotion(b),
  batteryOptimizationDisabled: (b) =>
    permissionsActions.setBatteryOptimizationDisabled(b),
};

const titlePermissions = {
  fcm: "Notifications",
  locationBackground: "Localisation en arrière plan",
  locationForeground: "Localisation en cours d'activité",
  readContacts: "Contacts",
  phoneCall: "Appels",
  motion: "Détection de mouvement",
  batteryOptimizationDisabled: "Optimisation de la batterie",
};

// Function to check current permission status
const checkPermissionStatus = async (permission) => {
  try {
    switch (permission) {
      case "fcm":
        const { status: notifStatus } =
          await Notifications.getPermissionsAsync();
        return notifStatus === "granted";
      case "locationBackground":
        const { status: bgStatus } =
          await Location.getBackgroundPermissionsAsync();
        return bgStatus === "granted";
      case "locationForeground":
        const { status: fgStatus } =
          await Location.getForegroundPermissionsAsync();
        return fgStatus === "granted";
      case "readContacts":
        const { status: contactStatus } = await Contacts.getPermissionsAsync();
        return contactStatus === "granted";
      case "motion":
        return await requestPermissionMotion.checkPermission();
      case "phoneCall":
        // Note: Phone call permissions on iOS are determined at build time
        // and on Android they're requested at runtime
        return true; // This might need adjustment based on your specific implementation
      case "batteryOptimizationDisabled":
        if (Platform.OS !== "android") {
          return true; // iOS doesn't have battery optimization
        }
        try {
          const enabled = await isBatteryOptimizationEnabled();
          return !enabled; // true if optimization is disabled
        } catch (error) {
          console.error("Error checking battery optimization:", error);
          return false;
        }
      default:
        return false;
    }
  } catch (error) {
    console.error(`Error checking ${permission} permission:`, error);
    return false;
  }
};

const PermissionItem = ({ permission, status, onRequestPermission }) => (
  <View style={styles.permissionItem}>
    <TouchableOpacity
      onPress={() => onRequestPermission(permission)}
      style={styles.permissionButton}
    >
      <Text style={styles.permissionText}>{titlePermissions[permission]}</Text>

      <Ionicons
        name={status ? "checkmark-circle" : "close-circle"}
        size={24}
        color={status ? "green" : "red"}
      />
    </TouchableOpacity>
  </View>
);

export default function Permissions() {
  // Create permissions list based on platform
  const getPermissionsList = () => {
    const basePermissions = [
      "fcm",
      "phoneCall",
      "locationForeground",
      "locationBackground",
      "motion",
      "readContacts",
    ];

    // Add battery optimization only on Android
    if (Platform.OS === "android") {
      return [...basePermissions, "batteryOptimizationDisabled"];
    }

    return basePermissions;
  };

  const permissionsList = getPermissionsList();
  const permissionsState = usePermissionsState(permissionsList);

  // Memoize the check permissions function
  const checkAllPermissions = useCallback(async () => {
    for (const permission of permissionsList) {
      const status = await checkPermissionStatus(permission);
      setPermissions[permission](status);
    }
  }, [permissionsList]);

  // Check all permissions when component mounts
  useEffect(() => {
    checkAllPermissions();
  }, [checkAllPermissions]);

  // Listen for app state changes to re-check permissions when user returns from settings
  useEffect(() => {
    const handleAppStateChange = async (nextAppState) => {
      if (nextAppState === "active") {
        console.log("App became active, re-checking all permissions...");
        // Re-check all permissions when app becomes active
        await checkAllPermissions();
      }
    };

    const subscription = AppState.addEventListener(
      "change",
      handleAppStateChange,
    );

    return () => {
      subscription?.remove();
    };
  }, [checkAllPermissions]);

  const handleRequestPermission = async (permission) => {
    try {
      let granted = false;

      if (permission === "locationBackground") {
        // Ensure foreground location is granted first
        const fgGranted = await checkPermissionStatus("locationForeground");
        if (!fgGranted) {
          const fgReq = await requestPermissionLocationForeground();
          setPermissions.locationForeground(fgReq);
          if (!fgReq) {
            granted = false;
          } else {
            granted = await requestPermissionLocationBackground();
          }
        } else {
          granted = await requestPermissionLocationBackground();
        }
        setPermissions.locationBackground(granted);
      } else {
        granted = await requestPermissions[permission]();
        setPermissions[permission](granted);
      }

      // Double-check the status to ensure UI is in sync.
      // For battery optimization, this immediate check may still be 'enabled';
      // we'll re-check again on AppState 'active' after returning from Settings.
      const actualStatus = await checkPermissionStatus(permission);
      setPermissions[permission](actualStatus);
    } catch (error) {
      console.error(`Error requesting ${permission} permission:`, error);
    }
  };

  return (
    <>
      <Title style={styles.title}>Permissions</Title>
      <View style={styles.container}>
        {Object.entries(permissionsState).map(([permission, status]) => (
          <PermissionItem
            key={permission}
            permission={permission}
            status={status}
            onRequestPermission={handleRequestPermission}
          />
        ))}
        <Button
          mode="contained"
          onPress={openSettings}
          style={styles.settingsButton}
        >
          Paramétrer les permissions
        </Button>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    padding: 20,
  },
  title: { fontSize: 20, fontWeight: "bold", marginVertical: 15 },
  permissionItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 15,
  },
  permissionButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 5,
  },
  permissionText: {
    fontSize: 16,
    flex: 1,
  },
  settingsButton: {},
});
