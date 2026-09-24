#!/bin/bash
REPO="hernanharco/vidasaludable"
WEBHOOK_URL="http://178.104.93.84:9000/webhook"
SECRET="a1a76e76ccb493205b4ef2922a8597c30b13ec48dca34914b61a780111b9cc36"

if [ -z "$GITHUB_TOKEN" ]; then
    echo "Error: Set GITHUB_TOKEN env var first"
    echo "export GITHUB_TOKEN=ghp_xxxxx"
    exit 1
fi

echo "Creating webhook for $REPO..."

curl -X POST \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/$REPO/hooks" \
  -d "{
    \"name\": \"web\",
    \"active\": true,
    \"events\": [\"push\"],
    \"config\": {
      \"url\": \"$WEBHOOK_URL\",
      \"content_type\": \"json\",
      \"secret\": \"$SECRET\"
    }
  }" | python3 -m json.tool

echo ""
echo "Done! Webhook configured."
