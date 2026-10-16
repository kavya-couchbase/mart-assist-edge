import './style.css';
import { openDB, count, seed, vectorSearch, keywordSearch, getProduct, updateProduct, startSync, stopSync } from './db.js';
import { loadModel } from './embed.js';

const cfg = {
  syncUrl: import.meta.env.VITE_SYNC_URL,
  syncUser: import.meta.env.VITE_SYNC_USER,
  syncPass: import.meta.env.VITE_SYNC_PASS,
  askUrl: import.meta.env.VITE_ASK_URL,
  askToken: import.meta.env.VITE_ASK_TOKEN,
};

const $ = (s) => document.querySelector(s);
const state = { manualOffline: false, mode: 'vector', pending: new Set(), syncStatus: 'not configured' };
const isOnline = () => navigator.onLine && !state.manualOffline;

// ---------- status ----------
function renderStatus() {
  const online = isOnline();
  const net = $('#net');
  net.textContent = online ? 'Online' : 'Offline';
  net.dataset.state = online ? 'ok' : 'off';
  const sync = $('#sync');
  const s = online ? state.syncStatus : 'paused';
  sync.textContent = { idle: 'Up to date', busy: 'Syncing', connecting: 'Connecting', stopped: 'Stopped', offline: 'Waiting for network', paused: 'Paused', 'not configured': 'Not set up' }[s] || s;
  sync.dataset.state = s === 'idle' ? 'ok' : s === 'busy' || s === 'connecting' ? 'busy' : 'off';
  $('#pending').textContent = state.pending.size ? `${state.pending.size} change${state.pending.size > 1 ? 's' : ''} waiting to sync` : '';
  $('#offlineToggle').checked = state.manualOffline;
}

function connect() {
  if (!isOnline()) { stopSync(); renderStatus(); return; }
  startSync({
    url: cfg.syncUrl, username: cfg.syncUser, password: cfg.syncPass,
    onStatus: (st) => { state.syncStatus = st.status || 'stopped'; if (st.error) console.warn('sync', st.error); renderStatus(); },
    onPushed: (ids) => { ids.forEach(id => state.pending.delete(id)); renderStatus(); refreshPendingTags(); },
  });
}

window.addEventListener('online', connect);
window.addEventListener('offline', connect);
$('#offlineToggle').addEventListener('change', (e) => { state.manualOffline = e.target.checked; connect(); });

async function refreshCount() {
  $('#docs').textContent = `${await count()} products on this device`;
}

// ---------- search ----------
let lastQuery = '';
async function runSearch(question) {
  question = question.trim();
  if (!question) return;
  lastQuery = question;
  $('#q').value = question;
  const { rows, embedMs, searchMs } = state.mode === 'vector' ? await vectorSearch(question) : await keywordSearch(question);
  $('#timing').textContent = state.mode === 'vector'
    ? `Found on this device in ${Math.round(embedMs + searchMs)} ms (embedding ${Math.round(embedMs)} ms, vector search ${Math.round(searchMs)} ms)`
    : `Keyword match on this device in ${Math.round(searchMs)} ms`;
  renderResults(rows);
  renderAnswer(question, rows);
}

function renderResults(rows) {
  const list = $('#results');
  list.innerHTML = '';
  if (!rows.length) {
    list.innerHTML = `<li class="empty">No products match. ${state.mode === 'keyword' ? 'Keyword search needs the exact words. Switch to Meaning to search by intent.' : 'Try describing what the customer needs.'}</li>`;
    return;
  }
  for (const r of rows) {
    const li = document.createElement('li');
    li.className = 'row';
    li.dataset.id = r.id;
    li.innerHTML = `
      <div class="aisle"><span class="aisle-n">${r.aisle}</span><span class="aisle-l">Aisle</span></div>
      <div class="info">
        <div class="name">${r.name}</div>
        <div class="desc">${r.description}</div>
        <div class="meta"><span>${r.category}</span><span class="${r.stock < 10 ? 'low' : ''}">${r.stock} in stock</span>${r.distance != null ? `<span class="score">match ${(1 - r.distance).toFixed(2)}</span>` : ''}<span class="pend" hidden>Waiting to sync</span></div>
      </div>
      <button class="edit" type="button">Update</button>`;
    li.querySelector('.edit').addEventListener('click', () => openEditor(r.id));
    list.appendChild(li);
  }
  refreshPendingTags();
}

function refreshPendingTags() {
  document.querySelectorAll('#results .row').forEach(li => {
    li.querySelector('.pend').hidden = !state.pending.has(li.dataset.id);
  });
}

async function renderAnswer(question, rows) {
  const box = $('#answer');
  if (state.mode !== 'vector' || !rows.length) { box.hidden = true; return; }
  box.hidden = false;
  if (!isOnline()) {
    box.dataset.state = 'off';
    box.innerHTML = `<p class="a-title">Offline</p><p>Showing matches from this device. Assistant answers come back when the network does.</p>`;
    return;
  }
  if (!cfg.askUrl) {
    box.dataset.state = 'off';
    box.innerHTML = `<p class="a-title">Assistant not set up</p><p>Add VITE_ASK_URL to .env.local to enable answers from Amazon Bedrock.</p>`;
    return;
  }
  box.dataset.state = 'busy';
  box.innerHTML = `<p class="a-title">Asking Amazon Bedrock</p><p class="muted">Sending the question and ${rows.length} local matches.</p>`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const t0 = performance.now();
    const res = await fetch(cfg.askUrl, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', 'x-demo-token': cfg.askToken || '' },
      body: JSON.stringify({ question, products: rows.map(({ name, description, aisle, stock }) => ({ name, description, aisle, stock })) }),
    });
    if (!res.ok) throw new Error(`Assistant returned ${res.status}`);
    const { answer } = await res.json();
    if (question !== lastQuery) return;
    box.dataset.state = 'ok';
    box.innerHTML = `<p class="a-title">Assistant (Amazon Bedrock, ${Math.round(performance.now() - t0)} ms)</p><p></p>`;
    box.querySelector('p:last-child').textContent = answer;
  } catch (err) {
    box.dataset.state = 'off';
    box.innerHTML = `<p class="a-title">Assistant unavailable</p><p>${err.name === 'AbortError' ? 'No response in 12 seconds.' : err.message}. The matches below are from this device.</p>`;
  } finally { clearTimeout(timer); }
}

$('#searchForm').addEventListener('submit', (e) => { e.preventDefault(); runSearch($('#q').value); });
document.querySelectorAll('.try').forEach(b => b.addEventListener('click', () => runSearch(b.textContent)));
document.querySelectorAll('[name=mode]').forEach(r => r.addEventListener('change', (e) => { state.mode = e.target.value; if (lastQuery) runSearch(lastQuery); }));

// ---------- editor ----------
const dlg = $('#editor');
async function openEditor(id) {
  const p = await getProduct(id);
  dlg.dataset.id = id;
  $('#e-name').textContent = p.name;
  $('#e-aisle').value = p.aisle;
  $('#e-stock').value = p.stock;
  dlg.showModal();
}
$('#editForm').addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'save') return;
  const id = dlg.dataset.id;
  await updateProduct(id, { aisle: Number($('#e-aisle').value), stock: Number($('#e-stock').value) });
  state.pending.add(id);
  renderStatus();
  toast(isOnline() ? 'Saved on this device. Syncing now.' : 'Saved on this device. Will sync when back online.');
  if (lastQuery) runSearch(lastQuery);
});

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 3500);
}

// ---------- boot ----------
async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  await openDB();
  renderStatus();
  const banner = $('#banner');
  banner.hidden = false;
  banner.textContent = 'Loading the on-device model';
  const seen = {};
  await loadModel((p) => {
    if (p.status === 'progress' && p.total) {
      seen[p.file] = [p.loaded, p.total];
      const [l, t] = Object.values(seen).reduce((a, [x, y]) => [a[0] + x, a[1] + y], [0, 0]);
      banner.textContent = `Downloading the on-device model (${Math.round((l / t) * 100)}%). One time only.`;
    }
  });
  if ((await count()) === 0) {
    $('#setup').hidden = false;
    banner.hidden = true;
  } else {
    banner.hidden = true;
  }
  await refreshCount();
  connect();
  setInterval(async () => { await refreshCount(); if ((await count()) > 0) $('#setup').hidden = true; }, 2000);
}

$('#seedBtn').addEventListener('click', async () => {
  const btn = $('#seedBtn');
  btn.disabled = true;
  await seed((i, n) => { btn.textContent = `Loading ${i} of ${n}`; });
  $('#setup').hidden = true;
  await refreshCount();
  toast('Catalogue loaded on this device.');
});

boot().catch(err => { $('#banner').hidden = false; $('#banner').textContent = `Startup failed: ${err.message}`; console.error(err); });
