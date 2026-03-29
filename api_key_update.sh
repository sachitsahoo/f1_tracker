# Load .env if it exists
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

# Prompt only if not already set
if [ -z "$OPENF1_USERNAME" ]; then
  read -p "Enter OpenF1 username: " OPENF1_USERNAME
  echo "OPENF1_USERNAME=$OPENF1_USERNAME" >> .env
fi

if [ -z "$OPENF1_PASSWORD" ]; then
  read -s -p "Enter OpenF1 password: " OPENF1_PASSWORD
  echo
  echo "OPENF1_PASSWORD=$OPENF1_PASSWORD" >> .env
fi

VITE_OPENF1_API_KEY=$(curl -s -X POST "https://api.openf1.org/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=$OPENF1_USERNAME&password=$OPENF1_PASSWORD" | jq -r '.access_token')

if [ -z "$VITE_OPENF1_API_KEY" ] || [ "$VITE_OPENF1_API_KEY" = "null" ]; then
  echo "Failed to get token — check your credentials"
else
  # Overwrite existing key if present, otherwise append
  if grep -q "VITE_OPENF1_API_KEY" .env; then
    sed -i '' "s/VITE_OPENF1_API_KEY=.*/VITE_OPENF1_API_KEY=$VITE_OPENF1_API_KEY/" .env
  else
    echo "VITE_OPENF1_API_KEY=$VITE_OPENF1_API_KEY" >> .env
  fi
  echo "Token saved to .env"
fi