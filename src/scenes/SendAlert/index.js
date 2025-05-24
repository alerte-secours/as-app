import React, { useState, useCallback } from "react";
import { ScrollView, View } from "react-native";
import { useNavigation, CommonActions } from "@react-navigation/native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Button, IconButton, Title } from "react-native-paper";
import capitalize from "lodash.capitalize";

import IconByAlertLevel from "~/components/IconByAlertLevel";
import levelLabel from "~/misc/levelLabel";
import levelDesc from "~/misc/levelDesc";
import { createStyles, fontFamily } from "~/theme";
import HelpBlock from "./HelpBlock";
import RegisterRelativesButton from "./RegisterRelativesButton";
import NotificationsButton from "./NotificationsButton";
import ContributeButton from "./ContributeButton";

export default function SendAlert() {
  const navigation = useNavigation();

  const styles = useStyles();

  const [helpVisible, setHelpVisible] = useState(false);
  function toggleHelp() {
    setHelpVisible(!helpVisible);
  }

  const navigateTo = useCallback(
    (navOpts) =>
      navigation.dispatch({
        ...CommonActions.navigate(navOpts),
      }),
    [navigation],
  );

  const sendAlert = useCallback(
    function sendAlert(level) {
      switch (level) {
        case "red":
        case "yellow":
        case "green":
          navigateTo({
            name: "SendAlertConfirm",
            params: {
              alert: {
                level,
              },
            },
          });
          break;
        case "call":
          navigateTo({
            name: "SendAlertConfirm",
            params: {
              level: "red",
              confirmed: true,
              forceCallEmergency: true,
            },
          });
          break;
        case "unkown":
          navigateTo({
            name: "SendAlertFinder",
          });
          break;
      }
    },
    [navigateTo],
  );

  return (
    <ScrollView>
      <View style={styles.container}>
        <NotificationsButton />

        <View style={styles.head}>
          <Title style={styles.title}>Quelle est votre situation ?</Title>
          <IconButton
            accessibilityLabel={"aide"}
            style={[styles.helpBtn]}
            onPress={toggleHelp}
            size={styles.helpBtn.fontSize}
            icon={({ style, ...props }) => (
              <MaterialCommunityIcons
                name="help-circle"
                style={[
                  style,
                  styles.helpBtnIcon,
                  helpVisible && styles.helpBtnIconEnabled,
                ]}
                {...props}
              />
            )}
          />
        </View>

        <View style={styles.buttonsContainer}>
          <Button
            accessibilityLabel={levelLabel.red}
            mode="contained"
            style={[styles.button, styles.btnRed]}
            contentStyle={[styles.buttonContent]}
            labelStyle={[styles.buttonLabel]}
            onPress={() => sendAlert("red")}
            icon={({ size }) => (
              <View style={styles.iconContainer}>
                <IconByAlertLevel
                  level="red"
                  style={[styles.alertIcon]}
                  size={size}
                />
              </View>
            )}
          >
            {capitalize(levelLabel.red)}
          </Button>
          {helpVisible && (
            <HelpBlock
              style={[styles.helpBlock, styles.helpBlockRed]}
              labelStyle={styles.helpBlockLabel}
            >
              {levelDesc.red}
            </HelpBlock>
          )}

          <Button
            accessibilityLabel={levelLabel.yellow}
            mode="contained"
            style={[styles.button, styles.btnYellow]}
            contentStyle={[styles.buttonContent]}
            labelStyle={[styles.buttonLabel]}
            onPress={() => sendAlert("yellow")}
            icon={({ size }) => (
              <View style={styles.iconContainer}>
                <IconByAlertLevel
                  level="yellow"
                  style={[styles.alertIcon]}
                  size={size}
                />
              </View>
            )}
          >
            {capitalize(levelLabel.yellow)}
          </Button>
          {helpVisible && (
            <HelpBlock
              style={[styles.helpBlock, styles.helpBlockYellow]}
              labelStyle={styles.helpBlockLabel}
            >
              {levelDesc.yellow}
            </HelpBlock>
          )}

          <Button
            accessibilityLabel={levelLabel.green}
            mode="contained"
            style={[styles.button, styles.btnGreen]}
            contentStyle={[styles.buttonContent]}
            labelStyle={[styles.buttonLabel]}
            onPress={() => sendAlert("green")}
            icon={({ size }) => (
              <View style={styles.iconContainer}>
                <IconByAlertLevel
                  level="green"
                  style={[styles.alertIcon]}
                  size={size}
                />
              </View>
            )}
          >
            {capitalize(levelLabel.green)}
          </Button>
          {helpVisible && (
            <HelpBlock
              style={[styles.helpBlock, styles.helpBlockGreen]}
              labelStyle={styles.helpBlockLabel}
            >
              {levelDesc.green}
            </HelpBlock>
          )}

          <Button
            mode="contained"
            style={[styles.button, styles.btnUnkown]}
            contentStyle={[styles.buttonContent]}
            labelStyle={[styles.buttonLabel]}
            onPress={() => sendAlert("unkown")}
            icon={({ size }) => (
              <View style={styles.iconContainer}>
                <IconByAlertLevel
                  level="unknown"
                  style={[styles.alertIcon]}
                  size={size}
                />
              </View>
            )}
          >
            {capitalize(levelLabel.unkown)}
          </Button>

          <Button
            mode="contained"
            style={[styles.button, styles.btnCall]}
            contentStyle={[styles.buttonContent]}
            labelStyle={[styles.buttonLabel]}
            onPress={() => sendAlert("call")}
            icon={({ size }) => (
              <View style={styles.iconContainer}>
                <IconByAlertLevel
                  level="call"
                  style={[styles.alertIcon]}
                  size={size}
                />
              </View>
            )}
          >
            {capitalize(levelLabel.call)}
          </Button>
        </View>

        <ContributeButton />
      </View>
    </ScrollView>
  );
}

const useStyles = createStyles(
  ({ wp, hp, scaleText, theme: { colors, custom } }) => ({
    container: {
      flex: 1,
      paddingTop: hp(2),
      paddingBottom: hp(2),
      marginHorizontal: wp(7),
    },

    head: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    title: {
      ...scaleText({ fontSize: 18 }),
      fontFamily,
      flex: 14,
    },
    helpBtn: {
      ...scaleText({ fontSize: 16 }),
    },
    helpBtnIcon: {},

    buttonsContainer: {
      flex: 1,
      flexDirection: "column",
    },
    button: {
      marginTop: hp(1),
      height: hp(10),
    },
    buttonContent: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "flex-start",
      height: "100%",
    },
    buttonLabel: {
      color: custom.appColors.onColor,
      fontFamily,
      ...scaleText({ fontSize: 19 }),
      textTransform: "none",
      flex: 1,
      paddingHorizontal: wp(2.5),
      textAlign: "left",
      textShadowColor: "#545454",
      textShadowOffset: { width: 1, height: 1 },
      textShadowRadius: 1,
    },

    iconContainer: {
      justifyContent: "center",
      alignItems: "center",
      marginLeft: wp(2),
      marginRight: wp(2),
      height: "100%",
    },
    alertIcon: {
      color: custom.appColors.onColor,
      ...scaleText({ fontSize: 26 }),
      textShadowColor: "#545454",
      textShadowOffset: { width: 1, height: 1 },
      textShadowRadius: 1,
    },

    btnRed: {
      backgroundColor: custom.appColors.red,
    },
    btnYellow: {
      backgroundColor: custom.appColors.yellow,
    },
    btnGreen: {
      backgroundColor: custom.appColors.green,
    },
    btnUnkown: {
      backgroundColor: custom.appColors.unknown,
    },
    btnCall: {
      backgroundColor: custom.appColors.call,
    },

    helpBtnIconEnabled: {
      color: colors.primary,
    },
    helpBlock: {
      borderWidth: 1,
      marginTop: 2,
      borderRadius: 4,
      paddingHorizontal: wp(1),
      paddingVertical: hp(1),
    },
    helpBlockLabel: {
      ...scaleText({ fontSize: 15 }),
    },
    helpBlockRed: {
      borderColor: custom.appColors.red,
    },
    helpBlockYellow: {
      borderColor: custom.appColors.yellow,
    },
    helpBlockGreen: {
      borderColor: custom.appColors.green,
    },
  }),
);
