import React from "react";

import Maplibre from "@maplibre/maplibre-react-native";

import markerRed from "~/assets/img/marker-red.png";
import markerYellow from "~/assets/img/marker-yellow.png";
import markerGreen from "~/assets/img/marker-green.png";
import markerRedDisabled from "~/assets/img/marker-red-disabled.png";
import markerYellowDisabled from "~/assets/img/marker-yellow-disabled.png";
import markerGreenDisabled from "~/assets/img/marker-green-disabled.png";
import markerOrigin from "~/assets/img/marker-origin.png";

const images = {
  red: markerRed,
  yellow: markerYellow,
  green: markerGreen,
  redDisabled: markerRedDisabled,
  yellowDisabled: markerYellowDisabled,
  greenDisabled: markerGreenDisabled,
  origin: markerOrigin,
};

export default function FeatureImages() {
  return <Maplibre.Images images={images} />;
}
