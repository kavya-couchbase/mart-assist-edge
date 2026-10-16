import { Database, Replicator } from '@couchbase/lite-js';
import { embed } from './embed.js';
import { CATALOGUE } from './catalogue.js';

export let db;
let replicator;

// App Services expects "scope.collection". Must match the App Endpoint's scope + collection.
const COLL = 'store.products';

export async function openDB() {
  db = await Database.open({ name: 'mart-v2', version: 1, collections: { [COLL]: {} } });
  return db;
}

const products = () => db.getCollection(COLL);

export function embedText(p) {
  return `${p.name}. ${p.description}. Category: ${p.category}. ${(p.tags || []).join(', ')}`;
}

export async function count() {
  return products().count();
}

export async function seed(onStep) {
  let i = 0;
  for (const [name, description, category, aisle, stock, tags] of CATALOGUE) {
    const id = 'sku::' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '');
    const body = { type: 'product', name, description, category, aisle, stock, tags, updatedBy: 'seed', updatedAt: new Date().toISOString() };
    body.embedding = await embed(embedText(body));
    await products().save(products().createDocument(id, body));
    onStep?.(++i, CATALOGUE.length);
  }
}

// Vector search: brute-force COSINE_DISTANCE in SQL++.
// CBL-JS 1.0 has no vector index yet; native CBL (iOS/Android/C/.NET/Java) does.
export async function vectorSearch(question, k = 6) {
  const t0 = performance.now();
  const v = await embed(question);
  const t1 = performance.now();
  const q = db.createQuery(
    `SELECT META(p).id AS id, p.name, p.description, p.category, p.aisle, p.stock,
            COSINE_DISTANCE(p.embedding, $v) AS distance
     FROM store.products AS p WHERE p.type = 'product'
     ORDER BY distance LIMIT ${k}`);
  q.parameters = { v };
  const rows = await q.execute();
  const t2 = performance.now();
  return { rows, embedMs: t1 - t0, searchMs: t2 - t1 };
}

export async function keywordSearch(question, k = 6) {
  const t0 = performance.now();
  const q = db.createQuery(
    `SELECT META(p).id AS id, p.name, p.description, p.category, p.aisle, p.stock
     FROM store.products AS p
     WHERE p.type = 'product' AND (LOWER(p.name) LIKE $w OR LOWER(p.description) LIKE $w)
     LIMIT ${k}`);
  q.parameters = { w: `%${question.toLowerCase().trim()}%` };
  const rows = await q.execute();
  return { rows, embedMs: 0, searchMs: performance.now() - t0 };
}

export async function getProduct(id) {
  return products().getDocument(id);
}

export async function updateProduct(id, changes) {
  const doc = await products().getDocument(id);
  Object.assign(doc, changes, { updatedBy: 'store-associate', updatedAt: new Date().toISOString() });
  await products().save(doc);
}

// ---- Sync with Capella App Services ----
export function startSync({ url, username, password, onStatus, onPushed }) {
  if (!url) { onStatus?.({ status: 'not configured' }); return; }
  stopSync();
  replicator = new Replicator({
    database: db,
    url,
    credentials: { username, password },
    continuous: true,
    collections: { [COLL]: { push: { continuous: true }, pull: { continuous: true } } },
  });
  replicator.onStatusChange = (s) => onStatus?.(s);
  replicator.onDocuments = (_c, direction, docs) => {
    if (direction === 'push') onPushed?.(docs.filter(d => !d.error).map(d => d.docID));
  };
  replicator.run().catch(err => onStatus?.({ status: 'stopped', error: err }));
}

export function stopSync() {
  if (replicator) { try { replicator.stop(); } catch {} replicator = null; }
}
