#!/bin/bash

set -e

set -a
source .env.prod
set +a

# Export build time for consistent release naming
export BUILD_TIME=$(date +%s000)

# Clean previous bundle
echo "Cleaning previous bundle..."
rm -f ios/main.jsbundle*

# Get version from Info.plist for release naming
BUNDLE_VERSION=$(/usr/libexec/PlistBuddy -c "Print :CFBundleVersion" ios/AlerteSecours/Info.plist)
PACKAGE_VERSION=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" ios/AlerteSecours/Info.plist)
RELEASE_NAME="com.alertesecours.alertesecours@${PACKAGE_VERSION}+${BUNDLE_VERSION}"

# Generate the bundle and sourcemap
echo "Generating bundle and sourcemap..."
yarn react-native bundle \
  --platform ios \
  --dev false \
  --entry-file index.js \
  --bundle-output ios/main.jsbundle \
  --sourcemap-output ios/main.jsbundle.map \
  --minify true

# Get path to hermesc binary
HERMESC="node_modules/react-native/sdks/hermesc/osx-bin/hermesc"
if [ ! -f "$HERMESC" ]; then
  HERMESC="node_modules/react-native/sdks/hermes/build/bin/hermesc"
fi

# Convert to Hermes bytecode
echo "Converting to Hermes bytecode..."
"$HERMESC" \
  -O \
  -emit-binary \
  -output-source-map \
  -out=ios/main.jsbundle.hbc \
  -g \
  ios/main.jsbundle

# Create Sentry release and upload source maps
if [ -n "$SENTRY_AUTH_TOKEN" ]; then
  echo "Creating Sentry release and uploading artifacts..."
  
  # Create new release
  npx @sentry/cli releases new "$RELEASE_NAME"
  
  # Upload the sourcemap
  npx @sentry/cli releases files "$RELEASE_NAME" \
    upload-sourcemaps \
    --dist "$BUILD_TIME" \
    --rewrite \
    --strip-prefix "$(pwd)" \
    --url-prefix "app:///" \
    --validate \
    --log-level debug \
    ios/main.jsbundle.map \
    ios/main.jsbundle

  # Upload the Hermes bundle and its sourcemap
  npx @sentry/cli releases files "$RELEASE_NAME" \
    upload-sourcemaps \
    --dist "$BUILD_TIME" \
    --rewrite \
    --strip-prefix "$(pwd)" \
    --url-prefix "app:///" \
    --validate \
    --log-level debug \
    ios/main.jsbundle.hbc.map \
    ios/main.jsbundle.hbc
    
  # Finalize release
  npx @sentry/cli releases finalize "$RELEASE_NAME"
else
  echo "Warning: SENTRY_AUTH_TOKEN not set. Skipping sourcemap upload."
fi

# Move the Hermes bundle to the final location
mv ios/main.jsbundle.hbc ios/main.jsbundle

cd ios

# Create logs directory if it doesn't exist
mkdir -p ../logs

# Create archive using xcodebuild
echo "Creating archive..."
xcodebuild \
  -workspace AlerteSecours.xcworkspace \
  -scheme AlerteSecours \
  -configuration Release \
  -archivePath AlerteSecours.xcarchive \
  archive 2>&1 | tee "../logs/ios-archive-$(date +%Y%m%d-%H%M%S).log"

echo "Archive completed successfully at AlerteSecours.xcarchive"
