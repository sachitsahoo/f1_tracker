#!/usr/bin/env bash
set -euo pipefail

# Read credentials from macOS Keychain — never from .env
# To store credentials the first time:
#   security add-generic-password -a "your@email.com" -s "openf1" -w "yourpassword"

OPENF1_USERNAME=$(security find-generic-password -s "openf1" -g 2>&1 | grep '"acct"' | sed 's/.*"acct"<blob>="\(.*\)"/\1/')
OPENF1_PASSWORD=$(security find-generic-password -s "openf1" -w 2>/dev/null)

if [ -z "$OPENF1_USERNAME" ] || [ -z "$OPENF1_PASSWORD" ]; then
  echo "Credentials not found in Keychain. Run:"
  echo '  security add-generic-password -a "your@email.com" -s "openf1" -w "yourpassword"'
  exit 1
fi

VITE_OPENF1_API_KEY=$(curl -s -X POST "https://api.openf1.org/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=$OPENF1_USERNAME&password=$OPENF1_PASSWORD" | jq -r '.access_token')

if [ -z "$VITE_OPENF1_API_KEY" ] || [ "$VITE_OPENF1_API_KEY" = "null" ]; then
  echo "Failed to get token — check credentials in Keychain"
  exit 1
fi

# Update only the JWT in .env — credentials never touch this file
if grep -q "VITE_OPENF1_API_KEY" .env 2>/dev/null; then
  sed -i '' "s/VITE_OPENF1_API_KEY=.*/VITE_OPENF1_API_KEY=$VITE_OPENF1_API_KEY/" .env
else
  echo "VITE_OPENF1_API_KEY=$VITE_OPENF1_API_KEY" >> .env
fi

echo "Token refreshed."
