import BackgroundGeolocation from "react-native-background-geolocation";
import { Alert } from "react-native";

import { getLocationState } from "~/stores";

import openSettings from "~/lib/native/openSettings";

import setLocationState from "./setLocationState";

import camelCaseKeys from "~/utils/string/camelCaseKeys";

const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second

export async function getCurrentLocation() {
  let retries = 0;

  while (retries < MAX_RETRIES) {
    try {
      // Check for location permissions and services
      const state = await BackgroundGeolocation.getState();

      if (!state.enabled) {
        // Prompt the user to enable location services manually
        Alert.alert(
          "Services de localisation désactivés",
          "Veuillez activer les services de localisation pour utiliser cette fonctionnalité.",
          [
            { text: "Annuler", style: "cancel" },
            { text: "Ouvrir les paramètres", onPress: openSettings },
          ],
        );
        return null;
      }
      const authorizationStatus =
        await BackgroundGeolocation.requestPermission();

      const isAuthorized =
        authorizationStatus ===
          BackgroundGeolocation.AUTHORIZATION_STATUS_ALWAYS ||
        authorizationStatus ===
          BackgroundGeolocation.AUTHORIZATION_STATUS_WHEN_IN_USE;

      if (!isAuthorized) {
        // If unable to get permissions, provide a link to settings
        Alert.alert(
          "Autorisation de localisation requise",
          "Veuillez accorder l'autorisation de localisation pour utiliser cette fonctionnalité.",
          [
            { text: "Annuler", style: "cancel" },
            { text: "Ouvrir les paramètres", onPress: openSettings },
          ],
        );
        return null;
      }

      const location = await BackgroundGeolocation.getCurrentPosition({
        timeout: 30,
        persist: true,
        maximumAge: 5000,
        desiredAccuracy: BackgroundGeolocation.DESIRED_ACCURACY_HIGH,
        samples: 1,
      });
      const coords = camelCaseKeys(location.coords);
      setLocationState(coords);
      return coords;
    } catch (error) {
      console.log(
        `Erreur lors de l'obtention de la position actuelle (tentative ${
          retries + 1
        }/${MAX_RETRIES}):`,
        error,
      );
      retries++;
      if (retries < MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
      }
    }
  }

  console.log(
    "Nombre maximal de tentatives atteint. Utilisation de la dernière position connue",
  );
  return getLocationState().coords || {};
}
