import React from "react";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import AlertInfoLine from "~/containers/AlertInfoLine";
import useTimeDisplay from "~/hooks/useTimeDisplay";

export default function AlertInfoLineClosedTime({ alert, ...props }) {
  const { closedAt } = alert;
  const closedAtText = useTimeDisplay(closedAt);

  if (!closedAt) {
    return null;
  }

  return (
    <AlertInfoLine
      icon={() => (
        <MaterialCommunityIcons name="clock-time-four-outline" size={24} />
      )}
      text={`Terminée ${closedAtText}`}
      {...props}
    />
  );
}
