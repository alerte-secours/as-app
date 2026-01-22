# Location tracking QA checklist

Applies to the BackgroundGeolocation integration:
- [`trackLocation()`](src/location/trackLocation.js:34)
- [`TRACKING_PROFILES`](src/location/backgroundGeolocationConfig.js:126)

## Goals

1. Updates only when moved enough
   - IDLE: record/upload only after moving ~200m.
   - ACTIVE: record/upload after moving ~25m.
2. Works in foreground, background and terminated (Android + iOS).
3. Avoid uploads while stationary.

## Current implementation notes

- Movement-driven recording only:
  - IDLE uses `distanceFilter: 200` (aim: no updates while not moving).
  - ACTIVE uses `distanceFilter: 25`.
  - JS may request a persisted fix when entering ACTIVE (see [`applyProfile()`](src/location/trackLocation.js:351)).
- Upload strategy is intentionally simple:
  - Keep only the latest persisted geopoint: `maxRecordsToPersist: 1`.
  - No batching / thresholds: `batchSync: false`, `autoSyncThreshold: 0`.
  - When authenticated, each persisted location should upload immediately via native HTTP (works while JS is suspended).
  - Pre-auth: tracking may persist locally but `url` is empty so nothing is uploaded until auth is ready.

## Basic preconditions

- Location permissions: foreground + background granted.
- Motion permission granted.
- Network reachable.

## Foreground behavior

### IDLE (no open alert)

1. Launch app, ensure no open alert.
2. Stay stationary for 5+ minutes.
   - Expect: no repeated server updates.
3. Walk/drive ~250m.
   - Expect: at least one location persisted + uploaded.

### ACTIVE (open alert)

1. Open an alert owned by the current user.
2. Move ~30m.
   - Expect: at least one location persisted + uploaded.
3. Continue moving.
   - Expect: periodic updates roughly aligned with movement, not time.

## Background behavior

### IDLE

1. Put app in background.
2. Stay stationary.
   - Expect: no periodic uploads.
3. Move ~250m.
   - Expect: a persisted record and upload.

### ACTIVE

1. Put app in background.
2. Move ~30m.
   - Expect: updates continue.

## Terminated behavior

### Android

1. Ensure tracking enabled and authenticated.
2. Force-stop the app task.
3. Move ~250m in IDLE.
   - Expect: native service still records + uploads.
4. Move ~30m in ACTIVE.
   - Expect: native service still records + uploads.

### iOS

1. Swipe-kill the app.
2. Move significantly (expect iOS to relaunch app on stationary-geofence exit).
   - Expect: tracking resumes and uploads after movement.

## Debugging tips

- Observe logs in app:
  - `tracking_ctx` extras are updated on AppState changes and profile changes.
  - See [`updateTrackingContextExtras()`](src/location/trackLocation.js:63).
- Correlate:
  - `onLocation` events
  - `onHttp` events
  - pending queue (`BackgroundGeolocation.getCount()` in logs)
