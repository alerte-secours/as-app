#!/bin/bash

# Check if DEVICE environment variable is set
if [ -z "$DEVICE" ]; then
  echo "Error: DEVICE environment variable is not set."
  echo "Usage: DEVICE=emulator-5554 ./install-android.sh"
  exit 1
fi

# Navigate to the bundle release directory
cd android/app/build/outputs/bundle/release

# Build APKs with signing
java -jar /opt/bundletool-all-1.17.1.jar build-apks \
  --mode universal \
  --bundle ./app-release.aab \
  --output ./app.apks \
  --ks $HOME/lab/alerte-secours/as-app/android/app/debug.keystore \
  --ks-pass pass:android \
  --ks-key-alias androiddebugkey \
  --key-pass pass:android

# Convert .apks to .zip and extract
mv app.apks app.zip
unzip -o app.zip

# Install the APK on the device
adb -s $DEVICE install universal.apk

echo "Installation complete!"
