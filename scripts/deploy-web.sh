#!/usr/bin/env bash
# Builds the app and publishes it to AWS Amplify Hosting (manual deploy, no Git needed).
set -euo pipefail
REGION="${AWS_REGION:-ap-south-1}"
# Optional resource tag, e.g. TAG_KEY=owner TAG_VALUE=you@example.com
TAG_KEY="${TAG_KEY:-}"; TAG_VALUE="${TAG_VALUE:-}"
cd "$(dirname "$0")/.."

npm run build
rm -f site.zip && (cd dist && zip -qr ../site.zip .)

if [ -f .amplify-app-id ]; then APP_ID=$(cat .amplify-app-id); else
  APP_ID=$(aws amplify create-app --name mart-assist --platform WEB --region $REGION \
    ${TAG_KEY:+--tags $TAG_KEY=$TAG_VALUE} --query app.appId --output text)
  aws amplify create-branch --app-id $APP_ID --branch-name main --region $REGION >/dev/null
  echo $APP_ID > .amplify-app-id
fi

read JOB URL_UP < <(aws amplify create-deployment --app-id $APP_ID --branch-name main --region $REGION \
  --query '[jobId,zipUploadUrl]' --output text)
curl -s -T site.zip "$URL_UP" >/dev/null
aws amplify start-deployment --app-id $APP_ID --branch-name main --job-id $JOB --region $REGION >/dev/null
rm -f site.zip

echo "Deploying (about 30 seconds)."
for i in $(seq 1 40); do
  S=$(aws amplify get-job --app-id $APP_ID --branch-name main --job-id $JOB --region $REGION --query job.summary.status --output text)
  [ "$S" = "SUCCEED" ] && break
  [ "$S" = "FAILED" ] && { echo "Deploy failed"; exit 1; }
  sleep 3
done
echo "Live: https://main.$APP_ID.amplifyapp.com"
echo "Add that URL to App Services CORS allowed origins if it is not there yet."
