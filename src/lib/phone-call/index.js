import { Platform, Linking } from "react-native";
import RNImmediatePhoneCall from "react-native-immediate-phone-call";

export function phoneCallEmergency() {
  const emergencyNumber = "+112";

  if (Platform.OS === "ios") {
    // Use telprompt URL scheme on iOS
    Linking.openURL(`telprompt:${emergencyNumber}`).catch((err) => {
      console.error("Error opening phone dialer:", err);
      // Fallback to regular tel: if telprompt fails
      Linking.openURL(`tel:${emergencyNumber}`).catch((err) => {
        console.error("Error opening phone dialer (fallback):", err);
      });
    });
  } else {
    // Use RNImmediatePhoneCall on Android
    RNImmediatePhoneCall.immediatePhoneCall(emergencyNumber);
  }
}
