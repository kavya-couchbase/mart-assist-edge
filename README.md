# Mart Assist: offline-first vector search at the edge

A store-associate app that searches a grocery catalogue by meaning, with no network.
Couchbase Lite runs in the browser, Capella App Services syncs the data, and Amazon Bedrock writes answers when online.

Built for the talk *Always-on Search: Offline-First at the Edge* (AWS Community Day Mumbai 2026).

## What it shows

| Act | Action | Result |
|---|---|---|
| Online | Search "sugar-free sweets for a diabetic customer" | Local vector matches in ~20–40 ms plus a Bedrock answer with aisles |
| Offline | Wi-Fi off, search again | Same matches, same speed; answer falls back to matches only |
| Sync | Edit a product offline, Wi-Fi on | Change lands in Capella |
| Bonus | `pav bhaji` in Keyword vs Meaning | Keyword finds exact names; Meaning finds the basket |

## Architecture

| Layer | Tech | Without network |
|---|---|---|
| Local DB | `@couchbase/lite-js` 1.0.3 (IndexedDB) | Works |
| Embeddings | all-MiniLM-L6-v2, 384-dim, transformers.js on WASM | Works after first load |
| Vector search | SQL++ `COSINE_DISTANCE()` (brute force; CBL-JS has no vector index yet) | Works |
| Sync | Capella App Services, WebSocket replication | Resumes on reconnect |
| Answers | Lambda Function URL → Bedrock Converse API | Falls back to matches |
| Hosting | Vite + service worker; optional AWS Amplify Hosting | Reloads from cache |

## Prerequisites
- Node 22+, AWS CLI v2, a Capella account, Bedrock model access for a current Claude model.

## 1. Capella
1. Bucket `mart`, scope `store`, collection `products`.
2. App Service linked to the cluster; App Endpoint `martapp` on `mart.store.products`.
3. Access control: paste `capella/sync-function.js` (the editor must start with `function`). Save.
4. App User `associate1` with admin channel `store`.
5. Settings → Advanced → CORS:

| Field | Value |
|---|---|
| Origin | `http://localhost:5173` (plus your hosted URL) |
| Login Origin | `http://localhost:5173` (plus your hosted URL) |
| Headers | `Authorization, Content-Type` |

6. Connect tab: copy the public URL, `wss://<host>.apps.cloud.couchbase.com:4984/martapp`.

Check: `curl -i -u associate1:<pw> https://<host>.apps.cloud.couchbase.com:4984/martapp/` returns 200.

## 2. Terminal
```sh
npm install --ignore-scripts
cp .env.example .env.local          # fill VITE_SYNC_URL / USER / PASS

# Bedrock endpoint: pick an ID from
# aws bedrock list-inference-profiles --region <region> --query "inferenceProfileSummaries[].inferenceProfileId"
MODEL_ID='<inference profile id>' AWS_REGION=ap-south-1 npm run deploy:ask
# optional tags: TAG_KEY=owner TAG_VALUE=you@example.com npm run deploy:ask

npm start                           # http://localhost:5173
npm run deploy:web                  # optional: AWS Amplify Hosting
```

## 3. Browser
1. Open the app online; wait for the model download (~23 MB, once).
2. Click **Load catalogue** on the first device only. Other devices receive products through sync.
3. Reload once online so the service worker caches everything.

## Gotchas
- **Sync shows "Waiting for network":** CORS Login Origin or the `Authorization` header is missing.
- **Sync shows "Stopped":** collections sync as `scope.collection`; the app uses `store.products`.
- **Assistant 401:** each `deploy:ask` rotates the token. Restart `npm start`, and never export `VITE_*` in your shell (Vite prefers shell variables over `.env.local`).
- **Assistant 502:** check `aws logs tail /aws/lambda/mart-assist-ask --since 15m`. Legacy models are blocked; newer Claude models reject `temperature`, so the Lambda doesn't send it.
- One tab per browser: CBL-JS doesn't lock a database across tabs.

## Security notes
This is a demo. Sync credentials sit in the client bundle and the Ask endpoint is public behind a shared token.
In production use OIDC/Bearer auth for sync and an authenticated API.

## Cleanup
```sh
aws lambda delete-function --function-name mart-assist-ask --region ap-south-1
aws iam delete-role-policy --role-name mart-assist-ask-role --policy-name bedrock-invoke
aws iam detach-role-policy --role-name mart-assist-ask-role --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
aws iam delete-role --role-name mart-assist-ask-role
aws amplify delete-app --app-id $(cat .amplify-app-id) --region ap-south-1   # if deploy:web was used
```

## License
Apache 2.0. Catalogue brand names are invented. Couchbase and the Couchbase logo are trademarks of Couchbase, Inc.
