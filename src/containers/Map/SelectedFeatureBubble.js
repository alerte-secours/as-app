import React from "react";

import SelectedFeatureBubbleAlert from "./SelectedFeatureBubbleAlert";

export default function SelectedFeatureBubble(props) {
  const { properties = {} } = props.feature;
  if (properties.alert) {
    return <SelectedFeatureBubbleAlert {...props} />;
  }
  return null;
}
