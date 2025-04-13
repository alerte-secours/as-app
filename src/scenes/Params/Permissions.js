import React, { useEffect, useCallback } from "react";
import { View, TouchableOpacity, StyleSheet } from "react-native";
import { Button, Title } from "react-native-paper";
import { usePermissionsState, permissionsActions } from "~/stores";
import { Ionicons } from "@expo/vector-icons";
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

const requestPermissions = {
  fcm: requestPermissionFcm,
  locationBackground: requestPermissionLocationBackground,
  locationForeground: requestPermissionLocationForeground,
  readContacts: requestPermissionReadContacts,
  phoneCall: requestPermissionPhoneCall,
  motion: requestPermissionMotion.requestPermission,
};

const setPermissions = {
  fcm: (b) => permissionsActions.setFcm(b),
  locationBackground: (b) => permissionsActions.setLocationBackground(b),
  locationForeground: (b) => permissionsActions.setLocationForeground(b),
  readContacts: (b) => permissionsActions.setReadContacts(b),
  phoneCall: (b) => permissionsActions.setPhoneCall(b),
  motion: (b) => permissionsActions.setMotion(b),
};

const titlePermissions = {
  fcm: "Notifications",
  locationBackground: "Localisation en arrière plan",
  locationForeground: "Localisation en cours d'activité",
  readContacts: "Contacts",
  phoneCall: "Appels",
  motion: "Détection de mouvement",
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
  const permissionsState = usePermissionsState([
    "fcm",
    "phoneCall",
    "locationForeground",
    "locationBackground",
    "motion",
    "readContacts",
  ]);

  // Memoize the check permissions function
  const checkAllPermissions = useCallback(async () => {
    const permissionKeys = [
      "fcm",
      "phoneCall",
      "locationForeground",
      "locationBackground",
      "motion",
      "readContacts",
    ];

    for (const permission of permissionKeys) {
      const status = await checkPermissionStatus(permission);
      setPermissions[permission](status);
    }
  }, []);

  // Check all permissions when component mounts
  useEffect(() => {
    checkAllPermissions();
  }, [checkAllPermissions]);

  const handleRequestPermission = async (permission) => {
    try {
      const granted = await requestPermissions[permission]();
      setPermissions[permission](granted);

      // Double-check the status to ensure UI is in sync
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
