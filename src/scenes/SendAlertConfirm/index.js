import React from "react";

import SendAlertConfirmView from "./SendAlertConfirmView";

import { useForm, FormProvider } from "react-hook-form";

export default function SendAlertConfirm({ route }) {
  const { params } = route;

  const { alert } = params;
  const level = alert?.level || params.level;
  const callEmergency = params.forceCallEmergency || level === "red";

  const methods = useForm({
    defaultValues: {
      subject: alert?.title || "",
      level,
      callEmergency,
      notifyAround: true,
      notifyRelatives: true,
    },
  });

  return (
    <FormProvider {...methods}>
      <SendAlertConfirmView confirmed={params.confirmed} />
    </FormProvider>
  );
}
