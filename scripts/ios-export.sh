#!/bin/bash

# Source the .env.prod file
set -a
source .env.prod
set +a

# Print debug information
echo "Debug information:"
echo "ASC_API_KEY_PATH: $ASC_API_KEY_PATH"
echo "ASC_API_KEY_ID: $ASC_API_KEY_ID"
echo "ASC_API_ISSUER_ID: $ASC_API_ISSUER_ID"
echo "PROVIDER_ID: $PROVIDER_ID"

# Verify the auth key file exists
if [ ! -f "$ASC_API_KEY_PATH" ]; then
    echo "Error: Authentication key file not found at: $ASC_API_KEY_PATH"
    exit 1
fi

echo "Auth key file exists at: $ASC_API_KEY_PATH"
echo "File permissions:"
ls -l "$ASC_API_KEY_PATH"

# Execute xcodebuild with the environment variables
cd ios && xcodebuild -exportArchive \
    -archivePath AlerteSecours.xcarchive \
    -exportPath ./build \
    -exportOptionsPlist exportOptions.plist \
    -allowProvisioningUpdates \
    -authenticationKeyID "$ASC_API_KEY_ID" \
    -authenticationKeyIssuerID "$ASC_API_ISSUER_ID" \
    -authenticationKeyPath "$ASC_API_KEY_PATH" \
    -verbose
