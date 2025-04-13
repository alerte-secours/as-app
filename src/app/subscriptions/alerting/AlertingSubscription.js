import React, { useEffect } from "react";
import { useMutation } from "@apollo/client";
import useStreamQueryWithSubscription from "~/hooks/useStreamQueryWithSubscription";
import { alertActions } from "~/stores";
import { createLogger } from "~/lib/logger";
import { FEATURE_SCOPES, NETWORK_SCOPES } from "~/lib/logger/scopes";

import {
  ALERTING_QUERY,
  ALERTING_SUBSCRIPTION,
  ACKNOWLEDGE_ALERTING_MUTATION,
} from "./gql";

const alertingLogger = createLogger({
  module: FEATURE_SCOPES.ALERTS,
  feature: NETWORK_SCOPES.GRAPHQL,
});

const AlertingSubscription = () => {
  // Alerting subscription
  const { data: alertingData, error: alertingError } =
    useStreamQueryWithSubscription(ALERTING_QUERY, ALERTING_SUBSCRIPTION, {
      cursorVar: "cursor",
      cursorKey: "updatedSeq",
      uniqKey: "id",
      initialCursor: -1,
    });

  if (alertingError) {
    alertingLogger.error("Alerting subscription error", {
      error: alertingError.message,
      stack: alertingError.stack,
    });
  }

  const [acknowledgeAlertingMutation] = useMutation(
    ACKNOWLEDGE_ALERTING_MUTATION,
  );

  // Effect for alerting data
  useEffect(() => {
    if (!alertingData) {
      return;
    }

    alertActions.updateAlertingList(alertingData.selectManyAlerting);

    // Acknowledge unacknowledged alerts
    alertingData.selectManyAlerting.forEach((alerting) => {
      if (!alerting.acknowledged) {
        acknowledgeAlertingMutation({
          variables: { alertingId: alerting.id },
          update: (cache) => {
            cache.modify({
              id: cache.identify({ __typename: "alerting", id: alerting.id }),
              fields: {
                acknowledged: () => true,
              },
            });
          },
        });
      }
    });
  }, [alertingData, acknowledgeAlertingMutation]);

  return null;
};

export default AlertingSubscription;
