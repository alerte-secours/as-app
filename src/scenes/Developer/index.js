import React, { useState } from "react";
import { View, StyleSheet, ScrollView } from "react-native";
import * as Sentry from "@sentry/react-native";
import {
  Button,
  Card,
  Switch,
  Text,
  useTheme,
  Divider,
} from "react-native-paper";
import { createStyles } from "~/theme";
import env, { setStaging } from "~/env";
import { authActions } from "~/stores";

const reset = async () => {
  await authActions.logout();
};

const Section = ({ title, children }) => {
  const styles = useStyles();
  return (
    <Card style={styles.section} mode="outlined">
      <Card.Title title={title} />
      <Card.Content>{children}</Card.Content>
    </Card>
  );
};

export default function Developer() {
  const styles = useStyles();
  const [isStaging, setIsStaging] = useState(env.IS_STAGING);
  const triggerNullError = () => {
    try {
      // Wrap the null error in try-catch
      const nonExistentObject = null;
      nonExistentObject.someProperty.anotherProperty();
    } catch (error) {
      // Convert the native error to a JavaScript error that Error Boundary can handle
      throw new Error(`Controlled null error: ${error.message}`);
    }
  };

  const triggerExplicitError = () => {
    throw new Error("This is an explicit error throw test");
  };

  const triggerPromiseError = async () => {
    try {
      await Promise.reject(new Error("This is a promise rejection test"));
    } catch (error) {
      // Re-throw to trigger error boundary
      throw error;
    }
  };

  const triggerAsyncError = async () => {
    // Force this into a new call stack
    await new Promise((resolve) => setTimeout(resolve, 0));
    throw new Error("This is an async error test");
  };

  const triggerSentryError = () => {
    try {
      throw new Error("Manual Sentry capture test");
    } catch (error) {
      Sentry.captureException(error);
      // Don't re-throw - this should only go to Sentry
    }
  };

  // Add a more complex null error test that should be caught
  const triggerDeepNullError = () => {
    try {
      const obj = {
        level1: {
          level2: null,
        },
      };
      // This will cause a null error in a more realistic scenario
      obj.level1.level2.level3.something();
    } catch (error) {
      // Explicitly throw a new Error with the stack
      throw new Error(
        `Deep null error: ${error.message}\nStack: ${error.stack}`,
      );
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Section title="Environment Controls">
        <View style={styles.settingRow}>
          <Text variant="bodyLarge">Staging Environment</Text>
          <Switch
            value={isStaging}
            onValueChange={async (value) => {
              setIsStaging(value); // Update UI immediately
              await setStaging(value); // Persist the change
              await reset(); // Reset auth state
            }}
          />
        </View>
      </Section>

      <Section title="Environment URLs">
        <View>
          <View style={styles.urlRow}>
            <Text variant="bodyMedium" style={styles.urlLabel}>
              GRAPHQL_URL:
            </Text>
            <Text variant="bodyMedium" style={styles.urlValue}>
              {env.GRAPHQL_URL}
            </Text>
          </View>
          <View style={styles.urlRow}>
            <Text variant="bodyMedium" style={styles.urlLabel}>
              GRAPHQL_WS_URL:
            </Text>
            <Text variant="bodyMedium" style={styles.urlValue}>
              {env.GRAPHQL_WS_URL}
            </Text>
          </View>
          <View style={styles.urlRow}>
            <Text variant="bodyMedium" style={styles.urlLabel}>
              GEOLOC_SYNC_URL:
            </Text>
            <Text variant="bodyMedium" style={styles.urlValue}>
              {env.GEOLOC_SYNC_URL}
            </Text>
          </View>
          <View style={styles.urlRow}>
            <Text variant="bodyMedium" style={styles.urlLabel}>
              MINIO_URL:
            </Text>
            <Text variant="bodyMedium" style={styles.urlValue}>
              {env.MINIO_URL}
            </Text>
          </View>
          <View style={styles.urlRow}>
            <Text variant="bodyMedium" style={styles.urlLabel}>
              OA_FILES_URL:
            </Text>
            <Text variant="bodyMedium" style={styles.urlValue}>
              {env.OA_FILES_URL}
            </Text>
          </View>
        </View>
      </Section>

      <Divider style={styles.divider} />

      <Section title="Error Testing">
        <Button
          onPress={triggerNullError}
          style={styles.button}
          contentStyle={styles.buttonContent}
          labelStyle={styles.buttonLabel}
        >
          Test Null Error (Controlled)
        </Button>

        <Button
          onPress={triggerDeepNullError}
          style={styles.button}
          contentStyle={styles.buttonContent}
          labelStyle={styles.buttonLabel}
        >
          Test Deep Null Error
        </Button>

        <Button
          onPress={triggerExplicitError}
          style={styles.button}
          contentStyle={styles.buttonContent}
          labelStyle={styles.buttonLabel}
        >
          Test Explicit Error
        </Button>

        <Button
          onPress={triggerPromiseError}
          style={styles.button}
          contentStyle={styles.buttonContent}
          labelStyle={styles.buttonLabel}
        >
          Test Promise Error
        </Button>

        <Button
          onPress={triggerAsyncError}
          style={styles.button}
          contentStyle={styles.buttonContent}
          labelStyle={styles.buttonLabel}
        >
          Test Async Error
        </Button>

        <Button
          onPress={triggerSentryError}
          style={styles.button}
          contentStyle={styles.buttonContent}
          labelStyle={styles.buttonLabel}
        >
          Test Sentry Only
        </Button>
      </Section>
    </ScrollView>
  );
}

const useStyles = createStyles(({ wp, hp, scaleText, theme: { colors } }) => ({
  container: {
    flexGrow: 1,
    padding: 16,
    gap: 16,
  },
  section: {
    width: "100%",
    // backgroundColor: colors.surface,
  },
  button: {
    marginVertical: 4,
    backgroundColor: colors.primary,
  },
  buttonContent: {},
  buttonLabel: {
    color: colors.onPrimary,
  },
  settingRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  statusText: {
    color: colors.onSurface,
    opacity: 0.7,
  },
  divider: {
    marginVertical: 8,
  },
  urlRow: {
    flexDirection: "row",
    marginBottom: 8,
    paddingRight: 8,
  },
  urlLabel: {
    fontWeight: "bold",
    minWidth: 120,
    marginRight: 8,
  },
  urlValue: {
    flex: 1,
    flexWrap: "wrap",
  },
}));
