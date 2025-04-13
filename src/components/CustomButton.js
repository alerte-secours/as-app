import React from "react";
import { Button } from "react-native-paper";
import { createStyles, useTheme } from "~/theme";

const CustomButton = ({
  children,
  style,
  contentStyle,
  labelStyle,
  mode = "contained",
  ...props
}) => {
  const styles = useStyles();

  const theme = useTheme();
  const isOutlined = mode === "outlined";

  return (
    <Button
      {...props}
      mode={mode}
      style={[
        styles.button,
        style,
        {
          backgroundColor: isOutlined
            ? theme.colors.onPrimary
            : theme.colors.primary,
        },
      ]}
      contentStyle={[styles.content, contentStyle]}
      labelStyle={[
        styles.label,
        labelStyle,
        { color: isOutlined ? theme.colors.primary : theme.colors.onPrimary },
      ]}
    >
      {children}
    </Button>
  );
};

const useStyles = createStyles(({ theme: { colors } }) => ({
  button: {
    marginVertical: 5,
  },
  content: {
    minHeight: 48,
    paddingVertical: 8,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
  },
  label: {
    fontSize: 16,
    lineHeight: 20,
    textAlign: "center",
    flexWrap: "wrap",
  },
}));

export default CustomButton;
