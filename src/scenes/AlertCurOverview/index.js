import React, { useCallback, useState } from "react";
import { View, ImageBackground, ScrollView } from "react-native";
import { TouchableRipple, Button, Title } from "react-native-paper";
import { useIsFocused, useNavigation } from "@react-navigation/native";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import withConnectivity from "~/hoc/withConnectivity";

import {
  useAlertState,
  useSessionState,
  alertActions,
  useAggregatedMessagesState,
} from "~/stores";
import { getCurrentLocation } from "~/location";

import alertBigButtonBgMap from "~/assets/img/alert-big-button-bg-map.png";
import alertBigButtonBgMapGrey from "~/assets/img/alert-big-button-bg-map-grey.png";
import alertBigButtonBgMessages from "~/assets/img/alert-big-button-bg-messages.png";
import alertBigButtonBgMessagesGrey from "~/assets/img/alert-big-button-bg-messages-grey.png";

import Text from "~/components/Text";
import AlertInfoLineLevel from "~/containers/AlertInfoLines/Level";
import AlertInfoLineCode from "~/containers/AlertInfoLines/Code";
import AlertInfoLineDistance from "~/containers/AlertInfoLines/Distance";
import AlertInfoLineCreatedTime from "~/containers/AlertInfoLines/CreatedTime";
import AlertInfoLineClosedTime from "~/containers/AlertInfoLines/ClosedTime";
import AlertInfoLineSubject from "~/containers/AlertInfoLines/Subject";
import AlertInfoLineAddress from "~/containers/AlertInfoLines/Address";
import AlertInfoLineNear from "~/containers/AlertInfoLines/Near";
import AlertInfoLineW3w from "~/containers/AlertInfoLines/W3w";
import AlertInfoLineNotifiedCount from "~/containers/AlertInfoLines/NotifiedCount";
import AlertInfoLineRadius from "~/containers/AlertInfoLines/Radius";
import AlertInfoLineSentBy from "~/containers/AlertInfoLines/SentBy";

import {
  COMING_HELP_MUTATION,
  NOTIFY_AROUND_MUTATION,
  NOTIFY_RELATIVES_MUTATION,
  CLOSE_ALERT,
  REOPEN_ALERT,
  KEEP_OPEN_ALERT,
} from "./gql";

import useStyles from "./styles";
import SendSms from "./SendSms";
import PhoneCallEmergency from "./PhoneCallEmergency";

import { useMutation } from "@apollo/client";

import FieldLevel from "./FieldLevel";
import FieldSubject from "./FieldSubject";
import FieldFollowLocation from "./FieldFollowLocation";
import MapLinksButton from "~/containers/MapLinksButton";
import { useTheme } from "~/theme";

const COMING_HELP_MESSAGE = "Je viens vous aider";

export default withConnectivity(
  React.memo(function AlertCurOverview() {
    const styles = useStyles();
    const { colors } = useTheme();
    const { navAlertCur } = useAlertState(["navAlertCur"]);
    const { alert } = navAlertCur;
    // const isFocused = useIsFocused();
    // console.debug("Render AlertCurOverwiew", new Date(), { isFocused, alertId });

    const { messagesList } = useAggregatedMessagesState(["messagesList"]);
    const unreadMessagesForCurrentAlert =
      alert &&
      alert.id &&
      messagesList.filter((msg) => !msg.isRead && msg.alertId === alert.id)
        .length;

    const { id: alertId, userId } = alert;
    const { userId: sessionUserId } = useSessionState(["userId"]);
    const isSent = userId === sessionUserId;

    const navigation = useNavigation();

    const [notifyAroundMutation] = useMutation(NOTIFY_AROUND_MUTATION);
    const notifyAround = useCallback(async () => {
      await notifyAroundMutation({
        variables: {
          alertId,
        },
      });
    }, [alertId, notifyAroundMutation]);

    const [notifyRelativesMutation] = useMutation(NOTIFY_RELATIVES_MUTATION);
    const notifyRelatives = useCallback(async () => {
      await notifyRelativesMutation({
        variables: {
          alertId,
        },
      });
    }, [alertId, notifyRelativesMutation]);

    const [closeAlertMutation] = useMutation(CLOSE_ALERT);
    const closeAlert = useCallback(async () => {
      await closeAlertMutation({
        variables: { alertId },
        optimisticResponse: {
          doAlertClose: {
            ok: true,
            __typename: "AlertCloseOutput",
          },
        },
        update: (cache) => {
          // Find the alert in the cache and update its state
          cache.modify({
            id: cache.identify({ __typename: "alert", id: alertId }),
            fields: {
              state: () => "closed",
              closedAt: () => new Date().toISOString(),
            },
          });
        },
      });
    }, [alertId, closeAlertMutation]);

    const [reopenAlertMutation] = useMutation(REOPEN_ALERT);
    const reopenAlert = useCallback(async () => {
      await reopenAlertMutation({
        variables: { alertId },
      });
    }, [alertId, reopenAlertMutation]);

    const [keepOpenAlertMutation] = useMutation(KEEP_OPEN_ALERT);
    const keepOpenAlert = useCallback(async () => {
      await keepOpenAlertMutation({
        variables: { alertId },
      });
    }, [alertId, keepOpenAlertMutation]);

    const shouldDisplayKeepOpen = useCallback(() => {
      const createdAt = new Date(alert.createdAt);
      const now = new Date();
      const diff = now - createdAt;
      const hours = diff / (1000 * 60 * 60);

      // Check if alert is older than 23 hours
      if (hours < 23) {
        return false;
      }

      // Check if keep_open_at is null or less than 1 hour from now
      if (!alert.keepOpenAt) {
        return true;
      }

      const keepOpenAt = new Date(alert.keepOpenAt);
      const diffFromKeepOpen = keepOpenAt - now; // Future - now to get time until keepOpenAt
      const hoursUntilKeepOpen = diffFromKeepOpen / (1000 * 60 * 60);

      return hoursUntilKeepOpen <= 1; // Show button if less than 1 hour until keepOpenAt
    }, [alert.createdAt, alert.keepOpenAt]);

    const [comingHelpMutation] = useMutation(COMING_HELP_MUTATION);
    const comingHelp = useCallback(async () => {
      const coords = await getCurrentLocation();
      const { latitude, longitude } = coords;
      const location = {
        type: "Point",
        coordinates: [longitude, latitude],
      };
      await comingHelpMutation({
        variables: {
          id: navAlertCur.id,
          alertId: alert.id,
          text: COMING_HELP_MESSAGE,
          location,
        },
      });
      navigation.navigate({
        name: "AlertCur",
        params: {
          screen: "AlertCurTab",
          params: {
            screen: "AlertCurMessage",
          },
        },
      });
    }, [comingHelpMutation, alert.id, navAlertCur.id, navigation]);

    const quitAlert = useCallback(() => {
      alertActions.setNavAlertCur(null);
      navigation.navigate("AlertAggList");
    }, [navigation]);

    const { state } = alert;
    const isOpen = state === "open";
    const isClosed = state === "closed";
    const isArchived = state === "archived";

    const { level } = alert;
    const alertLevelEmergency = level === "red" || level === "yellow";

    const [parentScrollEnabled, setParentScrollEnabled] = useState(true);

    // if (!isFocused) {
    //   return null;
    // }
    return (
      <ScrollView
        keyboardShouldPersistTaps="handled"
        scrollEnabled={parentScrollEnabled}
        style={styles.scrollView}
      >
        {isClosed && <Title style={styles.title}>Alerte terminée</Title>}
        {isArchived && <Title style={styles.title}>Alerte archivée</Title>}
        <View style={styles.container}>
          <View style={styles.containerNav}>
            <View style={[styles.linkBox, styles.linkToMessages]}>
              <ImageBackground
                source={
                  isOpen
                    ? alertBigButtonBgMessages
                    : alertBigButtonBgMessagesGrey
                }
                resizeMode="cover"
              >
                <TouchableRipple
                  style={styles.linkBoxButton}
                  onPress={() => {
                    navigation.navigate("Main", {
                      screen: "AlertCur",
                      params: {
                        screen: "AlertCurTab",
                        params: {
                          screen: "AlertCurMessage",
                        },
                      },
                    });
                  }}
                >
                  <View style={styles.linkBoxButtonContent}>
                    {/* <MaterialCommunityIcons
                  style={styles.linkBoxButtonIcon}
                  name="chat-processing-outline"
                  size={64}
                /> */}
                    <View
                      style={{ flexDirection: "row", alignItems: "flex-start" }}
                    >
                      <Text style={styles.linkBoxButtonText}>Messages</Text>
                      {unreadMessagesForCurrentAlert > 0 && (
                        <Text style={styles.messageCounterText}>
                          {` (${
                            unreadMessagesForCurrentAlert > 99
                              ? "+99"
                              : unreadMessagesForCurrentAlert
                          })`}
                        </Text>
                      )}
                    </View>
                  </View>
                </TouchableRipple>
              </ImageBackground>
            </View>
            <View style={[styles.linkBox, styles.linkToMap]}>
              <ImageBackground
                source={isOpen ? alertBigButtonBgMap : alertBigButtonBgMapGrey}
                resizeMode="cover"
              >
                <TouchableRipple
                  onPress={() => {
                    navigation.navigate("Main", {
                      screen: "AlertCur",
                      params: {
                        screen: "AlertCurTab",
                        params: {
                          screen: "AlertCurMap",
                        },
                      },
                    });
                  }}
                  style={styles.linkBoxButton}
                >
                  <View style={styles.linkBoxButtonContent}>
                    {/* <MaterialCommunityIcons
                  style={styles.linkBoxButtonIcon}
                  name="map-marker-radius-outline"
                  size={64}
                /> */}
                    <Text style={styles.linkBoxButtonText}>Carte</Text>
                  </View>
                </TouchableRipple>
              </ImageBackground>
            </View>
          </View>

          <View style={styles.headContainerInfos}>
            <AlertInfoLineNotifiedCount alert={alert} noBorder={true} />
          </View>

          <View style={styles.containerActions}>
            {/* {isSent && alert.notifyRelatives && (
            <View
              key="relative-notifed"
              style={[styles.actionContainer, styles.actionRelativeNotified]}
            >
              <Text>Vos proches ont été notifiés</Text>
            </View>
          )} */}
            {isOpen && isSent && !alert.notifyRelatives && (
              <View
                key="notify-relative"
                style={[styles.actionContainer, styles.actionNotifyRelatives]}
              >
                <Button
                  mode="contained"
                  icon={() => (
                    <MaterialCommunityIcons
                      name="account-group"
                      style={[
                        styles.actionIcon,
                        styles.actionNotifyRelativesIcon,
                      ]}
                    />
                  )}
                  style={[
                    styles.actionButton,
                    styles.actionNotifyRelativesButton,
                  ]}
                  onPress={notifyRelatives}
                >
                  <Text
                    style={[
                      styles.actionText,
                      styles.actionNotifyRelativesText,
                    ]}
                  >
                    Prévenir mes proches via l'application
                  </Text>
                </Button>
              </View>
            )}
            {isOpen && isSent && !alert.notifyAround && (
              <View
                key="notify-around"
                style={[styles.actionContainer, styles.actionNotifyAround]}
              >
                <Button
                  mode="contained"
                  icon={() => (
                    <MaterialCommunityIcons
                      name="map-marker-radius"
                      style={[styles.actionIcon, styles.actionNotifyAroundIcon]}
                    />
                  )}
                  style={[styles.actionButton, styles.actionNotifyAroundButton]}
                  onPress={notifyAround}
                >
                  <Text
                    style={[styles.actionText, styles.actionNotifyAroundText]}
                  >
                    Alerter aux alentours via l'application
                  </Text>
                </Button>
              </View>
            )}
            {isOpen && !isSent && !navAlertCur.comingHelp && (
              <View
                key="coming-help"
                style={[styles.actionContainer, styles.actionComing]}
              >
                <Button
                  mode="contained"
                  icon={() => (
                    <MaterialCommunityIcons
                      // name="run-fast"
                      name="run"
                      // name="account-voice"
                      // name="handshake"
                      style={[styles.actionIcon, styles.actionComingHelpIcon]}
                    />
                  )}
                  style={[styles.actionButton, styles.actionComingHelpButton]}
                  onPress={comingHelp}
                >
                  <Text
                    style={[styles.actionText, styles.actionComingHelpText]}
                  >
                    Je viens vous aider
                  </Text>
                </Button>
              </View>
            )}

            {!isSent && alert.location?.coordinates && (
              <MapLinksButton coordinates={alert.location.coordinates} />
            )}

            {isOpen && isSent && <SendSms />}
            {isOpen && isSent && alertLevelEmergency && <PhoneCallEmergency />}

            {isOpen && isSent && shouldDisplayKeepOpen() && (
              <View
                key="keep-open"
                style={[styles.actionContainer, styles.actionKeepOpen]}
              >
                <Button
                  mode="contained"
                  icon={() => (
                    <MaterialCommunityIcons
                      name="clock-outline"
                      style={[styles.actionIcon, styles.actionKeepOpenIcon]}
                    />
                  )}
                  style={[styles.actionButton, styles.actionKeepOpenButton]}
                  onPress={keepOpenAlert}
                >
                  <Text style={[styles.actionText, styles.actionKeepOpenText]}>
                    Garder l'alerte ouverte
                  </Text>
                </Button>
              </View>
            )}

            {isOpen && isSent && (
              <View
                key="close"
                style={[styles.actionContainer, styles.actionClose]}
              >
                <Button
                  mode="contained"
                  icon={() => (
                    <MaterialCommunityIcons
                      name="close-circle-outline"
                      style={[styles.actionIcon, styles.actionCloseIcon]}
                    />
                  )}
                  style={[styles.actionButton, styles.actionCloseButton]}
                  onPress={closeAlert}
                >
                  <Text style={[styles.actionText, styles.actionCloseText]}>
                    Terminer l'alerte
                  </Text>
                </Button>
              </View>
            )}

            {isClosed && isSent && (
              <View
                key="reopen"
                style={[styles.actionContainer, styles.actionReopen]}
              >
                <Button
                  mode="contained"
                  icon={() => (
                    <MaterialCommunityIcons
                      name="plus-circle-outline"
                      style={[styles.actionIcon, styles.actionReopenIcon]}
                    />
                  )}
                  style={[styles.actionButton, styles.actionReopenButton]}
                  onPress={reopenAlert}
                >
                  <Text style={[styles.actionText, styles.actionReopenText]}>
                    Rouvrir l'alerte
                  </Text>
                </Button>
              </View>
            )}

            {isSent && alert.location?.coordinates && (
              <MapLinksButton coordinates={alert.location.coordinates} />
            )}

            <View
              key="quit"
              style={[styles.actionContainer, styles.actionQuit]}
            >
              <Button
                mode="contained"
                icon={() => (
                  <MaterialCommunityIcons
                    name="exit-to-app"
                    style={[styles.actionIcon, styles.actionQuitIcon]}
                  />
                )}
                style={[styles.actionButton, styles.actionQuitButton]}
                onPress={quitAlert}
              >
                <Text style={[styles.actionText, styles.actionQuitText]}>
                  Quitter
                </Text>
              </Button>
            </View>
          </View>

          {isSent && isOpen && (
            <View style={styles.containerFields}>
              <FieldLevel alert={alert} />

              <FieldSubject
                alert={alert}
                setParentScrollEnabled={setParentScrollEnabled}
              />

              <FieldFollowLocation alert={alert} />
            </View>
          )}

          <View style={styles.containerInfos}>
            {(!isSent || !isOpen) && (
              <AlertInfoLineLevel alert={alert} isFirst />
            )}
            <AlertInfoLineCode alert={alert} />
            {!isSent && <AlertInfoLineDistance alert={alert} />}
            <AlertInfoLineCreatedTime alert={alert} />
            <AlertInfoLineClosedTime alert={alert} />
            {(!isSent || !isOpen) && <AlertInfoLineSubject alert={alert} />}
            <AlertInfoLineAddress alert={alert} />
            <AlertInfoLineNear alert={alert} />
            <AlertInfoLineW3w alert={alert} />
            <AlertInfoLineRadius alert={alert} />
            <AlertInfoLineSentBy alert={alert} />
          </View>
        </View>
      </ScrollView>
    );
  }),
);
