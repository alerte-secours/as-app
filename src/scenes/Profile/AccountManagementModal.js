import React, { useCallback, useState } from "react";

import { Portal, Modal } from "react-native-paper";

import { useStyles } from "./styles";

import AccountManagementModalConnect from "./AccountManagementModalConnect";
import AccountManagementModalDestroy from "./AccountManagementModalDestroy";
import AccountManagementModalImpersonate from "./AccountManagementModalImpersonate";

export default function AccountManagementModal({
  modalState,
  profileData,
  waitingSmsType,
  clearAuthWaitParams,
}) {
  const styles = useStyles();
  const [modal, setModal] = modalState;
  const { visible, component } = modal;
  const [authMethod, setAuthMethod] = useState(false);
  const closeModal = useCallback(() => {
    setModal({
      visible: false,
    });
    setAuthMethod(false);
  }, [setModal]);

  return (
    <Portal>
      <Modal
        visible={visible}
        onDismiss={closeModal}
        contentContainerStyle={styles.bottomModalContentContainer}
      >
        {visible && component === "connect" && (
          <AccountManagementModalConnect
            closeModal={closeModal}
            profileData={profileData}
            authMethod={authMethod}
            setAuthMethod={setAuthMethod}
            waitingSmsType={waitingSmsType}
            clearAuthWaitParams={clearAuthWaitParams}
          />
        )}
        {visible && component === "destroy" && (
          <AccountManagementModalDestroy
            closeModal={closeModal}
            profileData={profileData}
          />
        )}
        {visible && component === "impersonate" && (
          <AccountManagementModalImpersonate
            closeModal={closeModal}
            profileData={profileData}
          />
        )}
      </Modal>
    </Portal>
  );
}
