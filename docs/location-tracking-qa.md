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
  - IDLE uses `geolocation.distanceFilter: 200` (aim: no updates while not moving).
  - ACTIVE uses `geolocation.distanceFilter: 25`.
  - JS may request a persisted fix when entering ACTIVE (see [`applyProfile()`](src/location/trackLocation.js:351)).
- Upload strategy is intentionally simple:
  - Keep only the latest persisted geopoint: `persistence.maxRecordsToPersist: 1`.
  - No batching / thresholds: `batchSync: false`, `autoSyncThreshold: 0`.
  - When authenticated, each persisted location should upload immediately via native HTTP (works while JS is suspended).
  - Pre-auth: tracking may persist locally but `http.url` is empty so nothing is uploaded until auth is ready.

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
2. Swipe the app away from recents / kill the task.
3. Move ~250m in IDLE.
   - Expect: native service still records + uploads.
4. Move ~30m in ACTIVE.
   - Expect: native service still records + uploads.

> Note: This does **not** include Android Settings → **Force stop**.
> Force-stop prevents background services and receivers from running; no SDK can reliably track after that.

### iOS

1. Swipe-kill the app.
2. Move significantly (expect iOS to relaunch app on stationary-geofence exit).
   - Expect: tracking resumes and uploads after movement.

## Test matrix (quick)

| Platform | App state | Profile | Move | Expected signals |
|---|---|---|---:|---|
| Android | foreground | IDLE | ~250m | [`onLocation`](src/location/trackLocation.js:693) (sample=false), then [`onHttp`](src/location/trackLocation.js:733) |
| Android | background | IDLE | ~250m | same as above |
| Android | swipe-away | IDLE | ~250m | native persists + uploads; verify server + `onHttp` when app relaunches |
| Android | foreground | ACTIVE | ~30m | location + upload continues |
| iOS | background | IDLE | ~250m | movement-driven update; no periodic uploads while stationary |
| iOS | swipe-killed | IDLE | significant | OS relaunch on movement; upload after relaunch |

## What to look for in logs

- App lifecycle tagging: [`updateTrackingContextExtras()`](src/location/trackLocation.js:63) should update `tracking_ctx.app_state` on AppState changes.
- No time-based uploads: heartbeat is disabled (`heartbeatInterval: 0`), so no `Heartbeat` logs from [`onHeartbeat`](src/location/trackLocation.js:762).
- Movement-only uploads:
  - IDLE distance threshold: `distanceFilter: 200` in [`TRACKING_PROFILES`](src/location/backgroundGeolocationConfig.js:148).
  - ACTIVE distance threshold: `distanceFilter: 25` in [`TRACKING_PROFILES`](src/location/backgroundGeolocationConfig.js:148).

## Debugging tips

- Observe logs in app:
  - `tracking_ctx` extras are updated on AppState changes and profile changes.
  - See [`updateTrackingContextExtras()`](src/location/trackLocation.js:63).
- Correlate:
  - `onLocation` events
  - `onHttp` events
  - pending queue (`BackgroundGeolocation.getCount()` in logs)
