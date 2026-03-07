import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { View, StyleSheet } from "react-native";
import Maplibre from "@maplibre/maplibre-react-native";
import polyline from "@mapbox/polyline";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Button } from "react-native-paper";

import MapView from "~/containers/Map/MapView";
import Camera from "~/containers/Map/Camera";
import LastKnownLocationMarker from "~/containers/Map/LastKnownLocationMarker";
import { DEFAULT_ZOOM_LEVEL } from "~/containers/Map/constants";
import StepZoomButtonGroup from "~/containers/Map/StepZoomButtonGroup";

import Text from "~/components/Text";
import Loader from "~/components/Loader";
import { useTheme } from "~/theme";
import { useDefibsState, useNetworkState } from "~/stores";
import useLocation from "~/hooks/useLocation";
import { getDefibAvailability } from "~/utils/dae/getDefibAvailability";
import { osmProfileUrl } from "~/scenes/AlertCurMap/routing";

const STATUS_COLORS = {
  open: "#4CAF50",
  closed: "#F44336",
  unknown: "#9E9E9E",
};

function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return "";
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h${m}` : `${h}h`;
}

function formatDistance(meters) {
  if (!meters || meters <= 0) return "";
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

export default React.memo(function DAEItemCarte() {
  const { colors } = useTheme();
  const { selectedDefib: defib } = useDefibsState(["selectedDefib"]);
  const { hasInternetConnection } = useNetworkState(["hasInternetConnection"]);
  const { coords, isLastKnown, lastKnownTimestamp } = useLocation();

  const mapRef = useRef();
  const cameraRef = useRef();
  const [cameraKey, setCameraKey] = useState(1);
  const [zoomLevel, setZoomLevel] = useState(DEFAULT_ZOOM_LEVEL);
  const abortControllerRef = useRef(null);

  const refreshCamera = useCallback(() => {
    setCameraKey(`${Date.now()}`);
  }, []);

  const hasUserCoords =
    coords && coords.latitude !== null && coords.longitude !== null;
  const hasDefibCoords = defib && defib.latitude && defib.longitude;

  const [routeCoords, setRouteCoords] = useState(null);
  const [routeInfo, setRouteInfo] = useState(null);
  const [routeError, setRouteError] = useState(null);
  const [loadingRoute, setLoadingRoute] = useState(false);

  const profile = "foot"; // walking itinerary to defib

  // Compute route
  useEffect(() => {
    if (!hasUserCoords || !hasDefibCoords || !hasInternetConnection) {
      return;
    }

    // Abort any previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const fetchRoute = async () => {
      setLoadingRoute(true);
      setRouteError(null);
      try {
        const origin = `${coords.longitude},${coords.latitude}`;
        const target = `${defib.longitude},${defib.latitude}`;
        const osrmUrl = osmProfileUrl[profile] || osmProfileUrl.foot;
        const url = `${osrmUrl}/route/v1/${profile}/${origin};${target}?overview=full&steps=true`;

        const res = await fetch(url, { signal: controller.signal });
        const result = await res.json();

        if (result.routes && result.routes.length > 0) {
          const route = result.routes[0];
          const decoded = polyline
            .decode(route.geometry)
            .map((p) => p.reverse());
          setRouteCoords(decoded);
          setRouteInfo({
            distance: route.distance,
            duration: route.duration,
          });
        }
      } catch (err) {
        if (err.name !== "AbortError") {
          console.warn("Route calculation failed:", err.message);
          setRouteError(err);
        }
      } finally {
        setLoadingRoute(false);
      }
    };

    fetchRoute();

    return () => {
      controller.abort();
    };
  }, [
    hasUserCoords,
    hasDefibCoords,
    hasInternetConnection,
    coords,
    defib,
    profile,
  ]);

  // Defib marker GeoJSON
  const defibGeoJSON = useMemo(() => {
    if (!hasDefibCoords) return null;
    const { status } = getDefibAvailability(
      defib.horaires_std,
      defib.disponible_24h,
    );
    return {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [defib.longitude, defib.latitude],
          },
          properties: {
            id: defib.id,
            nom: defib.nom || "Défibrillateur",
            color: STATUS_COLORS[status],
          },
        },
      ],
    };
  }, [defib, hasDefibCoords]);

  // Route line GeoJSON
  const routeGeoJSON = useMemo(() => {
    if (!routeCoords || routeCoords.length < 2) return null;
    return {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: routeCoords,
      },
    };
  }, [routeCoords]);

  // Camera bounds to show both user + defib
  const bounds = useMemo(() => {
    if (!hasUserCoords || !hasDefibCoords) return null;
    const lats = [coords.latitude, defib.latitude];
    const lons = [coords.longitude, defib.longitude];
    return {
      ne: [Math.max(...lons), Math.max(...lats)],
      sw: [Math.min(...lons), Math.min(...lats)],
    };
  }, [hasUserCoords, hasDefibCoords, coords, defib]);

  if (!defib) return null;

  return (
    <View style={styles.container}>
      {/* Offline banner */}
      {!hasInternetConnection && (
        <View
          style={[
            styles.offlineBanner,
            { backgroundColor: (colors.error || "#F44336") + "15" },
          ]}
        >
          <MaterialCommunityIcons
            name="wifi-off"
            size={18}
            color={colors.error || "#F44336"}
          />
          <Text
            style={[
              styles.offlineBannerText,
              { color: colors.error || "#F44336" },
            ]}
          >
            Hors ligne — l'itinéraire n'est pas disponible
          </Text>
        </View>
      )}

      {/* Route info bar */}
      {routeInfo && (
        <View
          style={[
            styles.routeInfoBar,
            {
              backgroundColor: colors.surface,
              borderBottomColor: colors.outlineVariant || colors.grey,
            },
          ]}
        >
          <MaterialCommunityIcons
            name="walk"
            size={20}
            color={colors.primary}
          />
          <Text style={styles.routeInfoText}>
            {formatDistance(routeInfo.distance)}
            {routeInfo.duration
              ? ` · ${formatDuration(routeInfo.duration)}`
              : ""}
          </Text>
          {loadingRoute && (
            <Text
              style={[
                styles.routeInfoLoading,
                { color: colors.onSurfaceVariant || colors.grey },
              ]}
            >
              Mise à jour…
            </Text>
          )}
        </View>
      )}

      <MapView
        mapRef={mapRef}
        compassViewPosition={1}
        compassViewMargin={{ x: 10, y: 10 }}
      >
        <Camera
          cameraKey={cameraKey}
          setCameraKey={setCameraKey}
          refreshCamera={refreshCamera}
          cameraRef={cameraRef}
          followUserLocation={!bounds}
          followUserMode={
            bounds
              ? Maplibre.UserTrackingMode.None
              : Maplibre.UserTrackingMode.Follow
          }
          followPitch={0}
          zoomLevel={zoomLevel}
          bounds={bounds}
          detached={false}
        />

        {/* Route line */}
        {routeGeoJSON && (
          <Maplibre.ShapeSource id="routeSource" shape={routeGeoJSON}>
            <Maplibre.LineLayer
              id="routeLineLayer"
              style={{
                lineColor: "rgba(49, 76, 205, 0.84)",
                lineWidth: 4,
                lineCap: "round",
                lineJoin: "round",
                lineOpacity: 0.84,
              }}
            />
          </Maplibre.ShapeSource>
        )}

        {/* Defib marker */}
        {defibGeoJSON && (
          <Maplibre.ShapeSource id="defibItemSource" shape={defibGeoJSON}>
            <Maplibre.CircleLayer
              id="defibItemCircle"
              style={{
                circleRadius: 10,
                circleColor: ["get", "color"],
                circleStrokeColor: "#FFFFFF",
                circleStrokeWidth: 2.5,
              }}
            />
            <Maplibre.SymbolLayer
              id="defibItemLabel"
              aboveLayerID="defibItemCircle"
              style={{
                textField: ["get", "nom"],
                textSize: 12,
                textOffset: [0, 1.8],
                textAnchor: "top",
                textMaxWidth: 14,
                textColor: colors.onSurface,
                textHaloColor: colors.surface,
                textHaloWidth: 1,
              }}
            />
          </Maplibre.ShapeSource>
        )}

        {/* User location */}
        {isLastKnown && hasUserCoords ? (
          <LastKnownLocationMarker
            coordinates={coords}
            timestamp={lastKnownTimestamp}
            id="lastKnownLocation_daeItem"
          />
        ) : (
          <Maplibre.UserLocation visible showsUserHeadingIndicator />
        )}
      </MapView>
      <StepZoomButtonGroup mapRef={mapRef} setZoomLevel={setZoomLevel} />

      {/* Route error */}
      {routeError && !loadingRoute && (
        <View style={styles.routeErrorOverlay}>
          <Text
            style={[
              styles.routeErrorText,
              { color: colors.onSurfaceVariant || colors.grey },
            ]}
          >
            Impossible de calculer l'itinéraire
          </Text>
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  offlineBanner: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  offlineBannerText: {
    fontSize: 13,
    flex: 1,
  },
  routeInfoBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  routeInfoText: {
    fontSize: 15,
    fontWeight: "600",
    flex: 1,
  },
  routeInfoLoading: {
    fontSize: 12,
  },
  routeErrorOverlay: {
    position: "absolute",
    bottom: 16,
    left: 16,
    right: 16,
    alignItems: "center",
  },
  routeErrorText: {
    fontSize: 13,
    textAlign: "center",
  },
});
