import { useSubscription } from "@apollo/client";
import { useSessionState } from "~/stores";

import Loader from "~/components/Loader";

import { DEVICE_PARAMS_SUBSCRIPTION } from "./gql";

import ParamsView from "./View";
import Error from "~/components/Error";

import withConnectivity from "~/hoc/withConnectivity";

export default withConnectivity(function Params() {
  const { deviceId } = useSessionState(["deviceId"]);
  const { data, loading, error } = useSubscription(DEVICE_PARAMS_SUBSCRIPTION, {
    variables: {
      deviceId,
    },
  });
  if (loading || !data) {
    return <Loader />;
  }
  if (error) {
    return <Error />;
  }
  return <ParamsView data={data} />;
});
