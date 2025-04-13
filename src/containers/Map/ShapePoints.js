import React from "react";
import Maplibre from "@maplibre/maplibre-react-native";
import { createStyles, useTheme } from "~/theme";

import { CLUSTER_MIN_ZOOM_LEVEL, HITBOX_SIZE, textFont } from "./constants";

import AlertClusterCircleLayer from "./AlertClusterCircleLayer";
import AlertSymbolLayer from "./AlertSymbolLayer";

const hitbox = {
  width: HITBOX_SIZE,
  height: HITBOX_SIZE,
};

const useStyles = createStyles(({ theme: { colors } }) => ({
  clusterCount: {
    textField: "{point_count_abbreviated}",
    textSize: 12,
    textColor: colors.surface,
    textFont,
  },
}));

export default function ShapePoints({ shape, children, ...shapeSourceProps }) {
  const styles = useStyles();

  return (
    <Maplibre.ShapeSource shape={shape} hitbox={hitbox} {...shapeSourceProps}>
      <Maplibre.SymbolLayer
        id="pointCount"
        belowLayerID="points-green"
        filter={["has", "point_count"]}
        minZoomLevel={CLUSTER_MIN_ZOOM_LEVEL}
        style={styles.clusterCount}
      />

      <AlertClusterCircleLayer level="red" />
      <AlertClusterCircleLayer level="yellow" />
      <AlertClusterCircleLayer level="green" />

      <AlertSymbolLayer level="red" />
      <AlertSymbolLayer level="yellow" />
      <AlertSymbolLayer level="green" />

      <AlertSymbolLayer level="red" isDisabled />
      <AlertSymbolLayer level="yellow" isDisabled />
      <AlertSymbolLayer level="green" isDisabled />

      {children}
    </Maplibre.ShapeSource>
  );
}
