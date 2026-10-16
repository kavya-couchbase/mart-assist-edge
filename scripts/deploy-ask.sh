#!/usr/bin/env bash
# Deploys lambda/index.mjs as a Lambda Function URL that calls Amazon Bedrock.
# Usage: MODEL_ID=<inference profile id> AWS_REGION=ap-south-1 npm run deploy:ask
set -euo pipefail
: "${MODEL_ID:?Set MODEL_ID (copy from Bedrock console > Inference profiles or Model catalog)}"
REGION="${AWS_REGION:-ap-south-1}"
FN=mart-assist-ask
ROLE=mart-assist-ask-role
# Optional resource tag, e.g. TAG_KEY=owner TAG_VALUE=you@example.com
TAG_KEY="${TAG_KEY:-}"; TAG_VALUE="${TAG_VALUE:-}"
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
TOKEN=$(openssl rand -hex 16)
cd "$(dirname "$0")/.."

echo "Region $REGION, account $ACCOUNT, model $MODEL_ID"

if ! aws iam get-role --role-name $ROLE >/dev/null 2>&1; then
  aws iam create-role --role-name $ROLE ${TAG_KEY:+--tags Key=$TAG_KEY,Value=$TAG_VALUE} \
    --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
  aws iam attach-role-policy --role-name $ROLE --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
  aws iam put-role-policy --role-name $ROLE --policy-name bedrock-invoke --policy-document \
    '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["bedrock:InvokeModel","bedrock:InvokeModelWithResponseStream"],"Resource":"*"}]}'
  echo "Waiting for IAM role to propagate"; sleep 12
fi
ROLE_ARN=arn:aws:iam::$ACCOUNT:role/$ROLE

rm -f ask.zip && (cd lambda && zip -q ../ask.zip index.mjs)
ENVV="Variables={MODEL_ID=$MODEL_ID,DEMO_TOKEN=$TOKEN}"

if aws lambda get-function --function-name $FN --region $REGION >/dev/null 2>&1; then
  aws lambda update-function-code --function-name $FN --zip-file fileb://ask.zip --region $REGION >/dev/null
  aws lambda wait function-updated --function-name $FN --region $REGION
  aws lambda update-function-configuration --function-name $FN --environment "$ENVV" --region $REGION >/dev/null
else
  aws lambda create-function --function-name $FN --runtime nodejs22.x --handler index.handler \
    --role $ROLE_ARN --zip-file fileb://ask.zip --timeout 30 --memory-size 512 \
    --environment "$ENVV" ${TAG_KEY:+--tags $TAG_KEY=$TAG_VALUE} --region $REGION >/dev/null
  aws lambda wait function-active --function-name $FN --region $REGION
  aws lambda create-function-url-config --function-name $FN --auth-type NONE --region $REGION \
    --cors '{"AllowOrigins":["*"],"AllowMethods":["POST"],"AllowHeaders":["content-type","x-demo-token"],"MaxAge":3600}' >/dev/null
  aws lambda add-permission --function-name $FN --statement-id url-public --action lambda:InvokeFunctionUrl \
    --principal '*' --function-url-auth-type NONE --region $REGION >/dev/null
  aws lambda add-permission --function-name $FN --statement-id url-invoke --action lambda:InvokeFunction \
    --principal '*' --region $REGION >/dev/null 2>&1 || true
fi
aws lambda wait function-updated --function-name $FN --region $REGION

URL=$(aws lambda get-function-url-config --function-name $FN --region $REGION --query FunctionUrl --output text)
touch .env.local
grep -v '^VITE_ASK_' .env.local > .env.tmp || true
printf 'VITE_ASK_URL=%s\nVITE_ASK_TOKEN=%s\n' "$URL" "$TOKEN" >> .env.tmp && mv .env.tmp .env.local
rm -f ask.zip

echo "Testing Bedrock through the endpoint"
curl -s -X POST "$URL" -H 'content-type: application/json' -H "x-demo-token: $TOKEN" \
  -d '{"question":"quick breakfast","products":[{"name":"Rolled oats 1kg","description":"Whole grain oats","aisle":3,"stock":24}]}'
echo; echo "Done. Ask URL written to .env.local"
