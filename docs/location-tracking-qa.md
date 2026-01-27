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
  - IDLE relies on the SDK's **stop-detection + stationary geofence** (`geolocation.stopOnStationary` + `geolocation.stationaryRadius`) to avoid periodic stationary updates on Android.
    - We explicitly exit moving mode on entry to IDLE (`changePace(false)`) to prevent drift-generated periodic locations.
    - If the SDK later reports a real move (`onMotionChange(isMoving:true)`), JS may request **one** persisted fix as a fallback.
    - We intentionally do not rely on time-based updates.
  - ACTIVE uses `geolocation.distanceFilter: 25`.
  - JS may request a persisted fix when entering ACTIVE (see [`applyProfile()`](src/location/trackLocation.js:351)).
- Upload strategy is intentionally simple:
  - Keep only the latest persisted geopoint: `persistence.maxRecordsToPersist: 1`.
  - No batching / thresholds: `batchSync: false`, `autoSyncThreshold: 0`.
  - When authenticated, each persisted location should upload immediately via native HTTP (works while JS is suspended).
  - Pre-auth: tracking may persist locally but `http.url` is empty so nothing is uploaded until auth is ready.

- Stationary noise suppression:
  - Native accuracy gate for persisted/uploaded locations: `geolocation.filter.trackingAccuracyThreshold: 100`.
  - Identical location suppression: `geolocation.allowIdenticalLocations: false`.
  - IDLE primarily relies on stop-detection + stationary geofence (`stopOnStationary: true`) to eliminate periodic stationary updates.
  - Elasticity disabled (`disableElasticity: true`) to avoid dynamic distanceFilter shrink.
  - Extra safety: any JS-triggered persisted fix requests are tagged and ignored if accuracy > 100m.

## Concise testing checklist (Android + iOS)

### 1) Baseline setup

- App has foreground + background location permissions.
- Motion/Activity permission granted (iOS motion, Android activity-recognition if prompted).
- Logged-in (to validate native HTTP uploads).

### 2) IDLE (no open alert)

1. Launch app and confirm there is **no open alert** owned by the current user.
2. Leave phone stationary for 10+ minutes (screen on and screen off).
   - Expect: no periodic server uploads.
3. Walk/drive ~250m.
   - Expect: a movement-triggered persisted location + upload.

### 3) ACTIVE (open alert)

1. Open an alert owned by the current user.
2. Move ~30m.
   - Expect: at least one persisted location reaches server quickly.
3. Continue moving.
   - Expect: updates align with movement (distanceFilter-based), not time.

### 4) Lifecycle coverage

- Foreground → background: repeat IDLE and ACTIVE steps.
- Terminated:
  - Android: swipe-away from recents, then move the above distances and verify server updates.
  - iOS: swipe-kill, then move significantly and verify app relaunch + upload after relaunch.

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
   - Expect: `onMotionChange(isMoving:true)` then one persisted location + upload.

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
   - Expect: `onMotionChange(isMoving:true)` then one persisted record and upload.

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
| Android | foreground | IDLE | ~250m | [`onMotionChange`](src/location/trackLocation.js:1192) then [`onLocation`](src/location/trackLocation.js:1085) (sample=false), then [`onHttp`](src/location/trackLocation.js:1150) |
| Android | background | IDLE | ~250m | same as above |
| Android | swipe-away | IDLE | ~250m | native geofence triggers; verify server update; app may relaunch to deliver JS logs |
| Android | foreground | ACTIVE | ~30m | location + upload continues |
| iOS | background | IDLE | ~250m | movement-driven update; no periodic uploads while stationary |
| iOS | swipe-killed | IDLE | significant | OS relaunch on movement; upload after relaunch |

## What to look for in logs

- App lifecycle tagging: [`updateTrackingContextExtras()`](src/location/trackLocation.js:63) should update `tracking_ctx.app_state` on AppState changes.
- No time-based uploads: heartbeat is disabled (`heartbeatInterval: 0`).
- Movement-only uploads:
  - IDLE: look for `Motion change` (isMoving=true) and (in rare cases) `IDLE movement fallback fix`.
  - ACTIVE distance threshold: `distanceFilter: 25` in [`TRACKING_PROFILES`](src/location/backgroundGeolocationConfig.js:148).

- Attribution for `getCurrentPosition`:
  - `Location update received` logs include `extras.req_reason` and `extras.req_persist`.
  - Persisted-fix reasons to expect: `active_profile_enter`, `moving_edge`, `startup_fix`, `identity_fix:*`.

- Accuracy gate signals:
  - A persisted-fix request can be logged but later ignored due to accuracy > 100m.
  - If the server still receives periodic updates while stationary, check that the uploaded record has acceptable accuracy and that the device isn't flapping between moving/stationary.

## Debugging tips

- Observe logs in app:
  - `tracking_ctx` extras are updated on AppState changes and profile changes.
  - See [`updateTrackingContextExtras()`](src/location/trackLocation.js:63).
- Correlate:
  - `onLocation` events
  - `onHttp` events
  - pending queue (`BackgroundGeolocation.getCount()` in logs)
