import { useEffect, useRef, useCallback, useState } from "react";
import useLocation from "~/hooks/useLocation";
import { defibsActions, useDefibsState } from "~/stores";

const RADIUS_METERS = 10_000;

/**
 * Shared hook: loads defibs near user and exposes location + loading state.
 * The results live in the zustand store so both Liste and Carte tabs share them.
 */
export default function useNearbyDefibs() {
  const { coords, isLastKnown, lastKnownTimestamp } = useLocation();
  const { nearUserDefibs, loadingNearUser, errorNearUser } = useDefibsState([
    "nearUserDefibs",
    "loadingNearUser",
    "errorNearUser",
  ]);

  const hasLocation =
    coords && coords.latitude !== null && coords.longitude !== null;

  // Track whether we've already triggered a load for these coords
  const lastLoadedRef = useRef(null);
  const [noLocation, setNoLocation] = useState(false);

  const loadDefibs = useCallback(async () => {
    if (!hasLocation) {
      return;
    }
    const key = `${coords.latitude.toFixed(4)},${coords.longitude.toFixed(4)}`;
    if (lastLoadedRef.current === key) {
      return; // skip duplicate loads for same position
    }
    lastLoadedRef.current = key;
    await defibsActions.loadNearUser({
      userLonLat: [coords.longitude, coords.latitude],
      radiusMeters: RADIUS_METERS,
    });
  }, [hasLocation, coords]);

  useEffect(() => {
    if (hasLocation) {
      setNoLocation(false);
      loadDefibs();
    }
  }, [hasLocation, loadDefibs]);

  // After a timeout, if we still have no location, set the flag
  useEffect(() => {
    if (hasLocation) {
      return;
    }
    const timer = setTimeout(() => {
      if (!hasLocation) {
        setNoLocation(true);
      }
    }, 8000);
    return () => clearTimeout(timer);
  }, [hasLocation]);

  return {
    defibs: nearUserDefibs,
    loading: loadingNearUser,
    error: errorNearUser,
    hasLocation,
    noLocation,
    isLastKnown,
    lastKnownTimestamp,
    coords,
    reload: loadDefibs,
  };
}
