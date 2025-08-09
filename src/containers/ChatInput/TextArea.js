import React, { useRef, useState, useCallback, useEffect } from "react";
import { TextInput, Platform, InteractionManager } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { createStyles, useTheme } from "~/theme";

export default React.memo(function TextArea({
  value,
  onChangeText,
  autoFocus,
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [keyboardEnabled, setKeyboardEnabled] = useState(false);
  const textInputRef = useRef(null);
  const [isFocused, setIsFocused] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let timeout;
      const task = InteractionManager.runAfterInteractions(() => {
        timeout = setTimeout(() => {
          if (autoFocus && textInputRef.current) {
            textInputRef.current.focus();
          }
        }, 500);
      });
      return () => {
        task.cancel();
        clearTimeout(timeout);
        setKeyboardEnabled(false);
      };
    }, [textInputRef, autoFocus]),
  );

  const onBlur = useCallback(() => {
    setIsFocused(false);
    setKeyboardEnabled(false);
  }, []);

  useEffect(() => {
    if (!keyboardEnabled && autoFocus && !isFocused) {
      setTimeout(() => {
        textInputRef.current?.focus();
      }, 100);
    }
  }, [autoFocus, isFocused, keyboardEnabled]);

  return (
    <TextInput
      multiline
      maxLength={4096}
      style={styles.input}
      onChangeText={onChangeText}
      value={value}
      ref={textInputRef}
      textAlignVertical="center"
      autoFocus={autoFocus}
      showSoftInputOnFocus={keyboardEnabled} // controlled by state
      placeholder="Message"
      placeholderTextColor={colors.placeholder}
      onTouchStart={() => {
        if (!keyboardEnabled) {
          setKeyboardEnabled(true);
          // Wait a tick so that the TextInput re-renders with the new prop
          setTimeout(() => {
            textInputRef.current?.focus();
          }, 100);
        }
      }}
      onBlur={onBlur}
      onFocus={() => {
        setIsFocused(true);
      }}
    />
  );
});

const useStyles = createStyles(({ fontSize, wp, theme: { colors } }) => ({
  input: {
    flex: 1,
    color: colors.onBackground,
    fontSize: fontSize(14),
    height: "100%",
    textAlignVertical: "center",
    ...Platform.select({
      ios: {
        paddingTop: 10,
        paddingBottom: 10,
        lineHeight: 20,
      },
    }),
  },
}));
