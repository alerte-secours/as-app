import React, { useMemo } from "react";

import { View } from "react-native";
import { Button, Modal, Portal } from "react-native-paper";

import Text from "~/components/Text";
import { useRootNav } from "~/navigation/Context";
import { defibsActions, useDefibsState } from "~/stores";
import { useTheme } from "~/theme";

export default function DaeSuggestModal() {
  const { showDaeSuggestModal } = useDefibsState(["showDaeSuggestModal"]);
  const navigationRef = useRootNav();
  const { colors } = useTheme();

  const styles = useMemo(
    () => ({
      container: { backgroundColor: colors.surface, padding: 20 },
      title: { fontSize: 20, fontWeight: "bold" },
      paragraph: { marginTop: 10, fontSize: 16 },
      actionsRow: {
        marginTop: 18,
        flexDirection: "row",
        justifyContent: "space-between",
      },
      action: { flex: 1 },
      actionLeft: { marginRight: 12 },
    }),
    [colors.surface],
  );

  const dismiss = () => {
    defibsActions.setShowDaeSuggestModal(false);
  };

  const goToDaeList = () => {
    dismiss();

    // DAEList is inside the Drawer navigator which is the RootStack "Main" screen.
    // Using the root navigation ref makes this modal independent from current route.
    navigationRef?.current?.navigate("Main", {
      screen: "DAEList",
    });
  };

  return (
    <Portal>
      <Modal
        visible={!!showDaeSuggestModal}
        onDismiss={dismiss}
        contentContainerStyle={styles.container}
      >
        <Text style={styles.title}>Défibrillateur à proximité</Text>
        <Text style={styles.paragraph}>
          Votre alerte semble concerner un malaise grave / arrêt cardiaque.
          Recherchez rapidement un défibrillateur (DAE) près de vous.
        </Text>
        <View style={styles.actionsRow}>
          <Button
            style={[styles.action, styles.actionLeft]}
            mode="contained"
            onPress={goToDaeList}
          >
            Chercher un défibrillateur
          </Button>
          <Button style={styles.action} mode="outlined" onPress={dismiss}>
            Non merci
          </Button>
        </View>
      </Modal>
    </Portal>
  );
}
