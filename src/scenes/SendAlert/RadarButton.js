import React from "react";
import { View } from "react-native";
import { IconButton } from "react-native-paper";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { createStyles } from "~/theme";

export default function RadarButton({ onPress, isLoading = false, flex = 0.22 }) {
  const styles = useStyles();

  return (
    <View style={[styles.container, { flex }]}>
      <IconButton
        accessibilityLabel="Radar - Voir les utilisateurs Alerte-Secours prêts à porter secours aux alentours"
        mode="contained"
        size={24}
        style={styles.button}
        onPress={onPress}
        disabled={isLoading}
        icon={({ size, color }) => (
          <MaterialCommunityIcons
            name="radar"
            size={size}
            color={color}
            style={styles.icon}
          />
        )}
      />
    </View>
  );
}

const useStyles = createStyles(({ wp, hp, theme: { colors, custom } }) => ({
  container: {
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
    marginBottom: 10,
    flex: 1, // Stretch to fill available space
  },
  button: {
    backgroundColor: colors.primary,
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    minHeight: 48, // Match minimum touch target height
    width: "100%",
    maxWidth: 48, // Keep it square for radar button
  },
  icon: {
    color: colors.onPrimary,
  },
}));
