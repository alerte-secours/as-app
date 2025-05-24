import { useCallback } from "react";
import { useNavigation } from "@react-navigation/native";
import { useFormContext } from "react-hook-form";
import uuidGenerator from "react-native-uuid";

import { phoneCallEmergency } from "~/lib/phone-call";

import network from "~/network";
import { getSessionState, alertActions, useParamsState } from "~/stores";
import { getCurrentLocation } from "~/location";

import useSendAlertSMSToEmergency from "~/hooks/useSendAlertSMSToEmergency";

import { SEND_ALERT_MUTATION } from "./gql";

export default function useOnSubmit() {
  const navigation = useNavigation();
  const { handleSubmit } = useFormContext();
  const { preferredEmergencyCall } = useParamsState(["preferredEmergencyCall"]);
  const sendSMSToEmergency = useSendAlertSMSToEmergency();
  return useCallback(() => {
    handleSubmit((...args) => {
      onSubmit(args, {
        navigation,
        sendSMSToEmergency,
        preferredEmergencyCall,
      });
    })();
  }, [handleSubmit, navigation, preferredEmergencyCall, sendSMSToEmergency]);
}

async function onSubmit(args, context) {
  const [alertInput] = args;
  const { navigation } = context;

  const {
    subject,
    level,
    callEmergency,
    notifyAround,
    notifyRelatives,
    followLocation,
  } = alertInput;

  const coords = await getCurrentLocation();

  const {
    accuracy,
    altitude,
    altitudeAccuracy,
    heading,
    latitude,
    longitude,
    speed,
  } = coords;

  const location = {
    type: "Point",
    coordinates: [longitude, latitude],
  };

  const uuid = uuidGenerator.v4();

  const alertSendAlertInput = {
    uuid,
    subject,
    level,
    callEmergency,
    notifyAround,
    notifyRelatives,
    followLocation: !!followLocation,
    location,
    accuracy,
    altitude,
    altitudeAccuracy,
    heading,
    speed,
  };

  const { userId, deviceId } = getSessionState();
  const createdAt = new Date().toISOString();

  const alert = {
    level,
    state: "open",
    createdAt,
    subject,
    userId,
    deviceId,
    location,
  };

  let emergencyConnectRan;
  const runEmergencyConnect = () => {
    if (emergencyConnectRan) {
      return;
    }
    emergencyConnectRan = true;
    if (callEmergency) {
      const { preferredEmergencyCall, sendSMSToEmergency } = context;
      if (preferredEmergencyCall === "sms") {
        sendSMSToEmergency({ alert });
      } else {
        phoneCallEmergency();
      }
    }
  };

  const runEmergencyConnectTimeout = setTimeout(runEmergencyConnect, 10000); // let call or send sms even in case the server is unavailable

  const { data } = await network.apolloClient.mutate({
    mutation: SEND_ALERT_MUTATION,
    variables: {
      alertSendAlertInput,
    },
  });
  const {
    doAlertSendAlert: { alertId, code, accessCode },
  } = data;

  Object.assign(alert, {
    id: alertId,
    code,
    accessCode,
  });

  alertActions.setNavAlertCur({ alert });
  navigation.navigate("Main", {
    screen: "AlertCur",
    params: {
      screen: "AlertCurTab",
      params: {
        screen: "AlertCurOverview",
      },
    },
  });

  clearTimeout(runEmergencyConnectTimeout);
  runEmergencyConnect();
}
