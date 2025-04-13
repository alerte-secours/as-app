import { ToggleButton } from "react-native-paper";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useTheme } from "~/theme";

export default function MapLinksPopupIconButton({
  setIsVisible,
  textProps = {},
  ...extraProps
}) {
  const { colors, custom } = useTheme();
  return (
    <ToggleButton
      mode="contained"
      onPress={() => setIsVisible(true)}
      icon={() => (
        <MaterialCommunityIcons
          name="arrow-top-right-bold-box-outline"
          size={24}
          color={colors.onSurface}
        />
      )}
      style={{
        width: 32,
        height: 32,
        backgroundColor: colors.surface,
        color: colors.onSurface,
      }}
      {...extraProps}
    />
  );
}
