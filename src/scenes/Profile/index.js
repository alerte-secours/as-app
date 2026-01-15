import React, { useEffect } from "react";

import { ScrollView, View } from "react-native";

import Loader from "~/components/Loader";
import { useSubscription } from "@apollo/client";
import Error from "~/components/Error";

import { LOAD_PROFILE_SUBSCRIPTION } from "./gql";

import { useSessionState } from "~/stores";
import { createLogger } from "~/lib/logger";
import { FEATURE_SCOPES } from "~/lib/logger/scopes";

import withConnectivity from "~/hoc/withConnectivity";

import Form from "./Form";

const profileLogger = createLogger({
  module: FEATURE_SCOPES.PROFILE,
  feature: "screen",
});

export default withConnectivity(function Profile({ navigation, route }) {
  const { userId } = useSessionState(["userId"]);
  // profileLogger.debug("Profile user ID", { userId });
  const { data, loading, error, restart } = useSubscription(
    LOAD_PROFILE_SUBSCRIPTION,
    {
      variables: {
        userId,
      },
    },
  );

  useEffect(() => {
    restart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const clearAuthWaitParams = React.useCallback(() => {
    navigation.setParams({
      waitingSmsType: undefined,
      openAccountModal: undefined,
    });
  }, [navigation]);

  if (loading) {
    return <Loader />;
  }

  if (error) {
    profileLogger.error("Profile subscription error", { error });
    return <Error />;
  }

  if (!data?.selectOneUser) {
    // No error surfaced, but no payload either. Avoid infinite loader.
    profileLogger.error("Profile subscription returned no user", { userId });
    return <Error />;
  }

  return (
    <ScrollView
      style={{
        flex: 1,
        paddingHorizontal: 15,
        paddingVertical: 15,
      }}
    >
      <Form
        profileData={data}
        openAccountModal={route.params?.openAccountModal}
        waitingSmsType={route.params?.waitingSmsType}
        clearAuthWaitParams={clearAuthWaitParams}
      />
    </ScrollView>
  );
});
