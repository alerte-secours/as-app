import { useState, useEffect } from "react";
import AsyncStorage from "~/lib/memoryAsyncStorage";
import { Platform } from "react-native";

const EULA_STORAGE_KEY = "@eula_accepted";

export const useEULA = () => {
  const [eulaAccepted, setEulaAccepted] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (Platform.OS !== "ios") {
      setLoading(false);
      return;
    }

    const checkEULA = async () => {
      try {
        const accepted = await AsyncStorage.getItem(EULA_STORAGE_KEY);
        setEulaAccepted(!!accepted);
      } catch (error) {
        console.error("Error checking EULA status:", error);
        setEulaAccepted(false);
      } finally {
        setLoading(false);
      }
    };

    checkEULA();
  }, []);

  const acceptEULA = () => {
    setEulaAccepted(true);
  };

  return {
    eulaAccepted,
    loading,
    acceptEULA,
  };
};
