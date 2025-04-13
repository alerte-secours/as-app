import React from "react";
import { ToggleButton } from "react-native-paper";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { createStyles } from "~/theme";

export default function ToggleZoomButton({ value, selected, iconName, icon }) {
  const styles = useStyles();
  if (selected !== value) {
    return null;
  }
  return (
    <ToggleButton
      style={styles.boundTypeButton}
      icon={() =>
        icon ? (
          icon
        ) : (
          <MaterialCommunityIcons
            name={iconName}
            size={24}
            style={styles.icon}
          />
        )
      }
      value={value}
    />
  );
}

const useStyles = createStyles(({ theme: { colors } }) => ({
  boundTypeButton: {
    backgroundColor: colors.surface,
    height: 32,
    width: 32,
  },
  icon: {
    color: colors.onSurface,
  },
}));
