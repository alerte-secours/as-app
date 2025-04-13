#!/bin/bash

# Source the environment variables
set -a
source .env.prod
set +a

# Print debug information
echo "Debug information:"
echo "ASC_API_KEY_ID: $ASC_API_KEY_ID"
echo "ASC_API_ISSUER_ID: $ASC_API_ISSUER_ID"
echo "ASC_API_KEY_PATH: $ASC_API_KEY_PATH"

# Execute upload command
cd ios && xcrun altool --upload-app \
    --type ios \
    --file build/AlerteSecours.ipa \
    --apiKey $ASC_API_KEY_ID \
    --apiIssuer $ASC_API_ISSUER_ID \
    --apiKeyPath $ASC_API_KEY_PATH \
    --verbose
