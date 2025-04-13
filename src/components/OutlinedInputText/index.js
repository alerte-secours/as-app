import React, { forwardRef } from "react";
import { View, TextInput, Text } from "react-native";
import { createStyles, useTheme } from "~/theme";

function OutlinedInputText(
  { style, labelStyle, inputStyle, label, ...props },
  ref,
) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={[styles.container, style]}>
      <Text style={[styles.label, labelStyle]}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.outline}
        style={[styles.input, inputStyle]}
        ref={ref}
        {...props}
      />
    </View>
  );
}

const useStyles = createStyles(({ fontSize, theme: { colors } }) => ({
  container: {
    borderWidth: 1,
    borderRadius: 4,
    borderColor: colors.outline,
    backgroundColor: "transparent",
  },
  label: {
    position: "absolute",
    left: 6,
    paddingHorizontal: 4,
    zIndex: 2,
  },
  input: {
    backgroundColor: "transparent",
  },
}));

export default forwardRef(OutlinedInputText);
