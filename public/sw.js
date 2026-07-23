/* ═══════════════════════════════════════════════
   LifeSaver Cloud – sw.js
   Offline PWA cache + Background Sync for queued SOS alerts.
═══════════════════════════════════════════════ */

const CACHE_NAME = 'lifesaver-cloud-v2';
const FIRESTORE_PROJECT_ID = 'lifesaver-cloud';
const DB_NAME = 'lifesaver-offline';
const DB_STORE = 'pending-alerts';
const SYNC_TAG = 'sync-sos-alerts';

const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/firebase-config.js',
  './js/motion-detection.js',
  './js/ai-checkin.js',
  './js/pwa.js',
  './manifest.json',
  './icons/icon.svg'
];

// ─── Install / activate ───────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// ─── Fetch: cache-first for app shell, network-first fallback for the rest ─
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request)
        .then((response) => {
          if (response && response.ok && event.request.url.startsWith(self.location.origin)) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => {
          if (event.request.mode === 'navigate') return caches.match('./index.html');
        });
    })
  );
});

// ─── IndexedDB helpers (no external lib — keep the SW self-contained) ─────
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getAllPending() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const req = tx.objectStore(DB_STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function deletePending(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Writes a queued alert straight to Firestore via REST, using the cached
// ID token from the moment the alert was queued. Short offline gaps (the
// realistic case) keep the token valid; long gaps fail here and fall back
// to the normal Firestore SDK flush that app.js runs on the next 'online'
// event while the tab is open.
async function flushAlertToFirestore(entry) {
  const url = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT_ID}/databases/(default)/documents/users/${entry.uid}/alerts`;

  const body = {
    fields: {
      lat: { doubleValue: entry.payload.lat || 0 },
      lng: { doubleValue: entry.payload.lng || 0 },
      message: { stringValue: entry.payload.message || '' },
      status: { stringValue: 'offline-sync' },
      source: { stringValue: entry.payload.source || 'offline-queue' },
      contacts: {
        arrayValue: {
          values: (entry.payload.contacts || []).map((c) => ({ stringValue: String(c) }))
        }
      },
      timestamp: { timestampValue: entry.payload.queuedAt }
    }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${entry.idToken}`
    },
    body: JSON.stringify(body)
  });

  return res.ok;
}

async function replayQueuedAlerts() {
  const pending = await getAllPending();
  let flushedAny = false;

  for (const entry of pending) {
    try {
      const ok = await flushAlertToFirestore(entry);
      if (ok) {
        await deletePending(entry.id);
        flushedAny = true;
      }
    } catch (err) {
      // Leave it queued — the browser will retry the sync event, and the
      // page's own 'online' handler is a second-chance flush path too.
    }
  }

  if (flushedAny) {
    const clientsList = await self.clients.matchAll({ type: 'window' });
    clientsList.forEach((client) => client.postMessage({ type: 'offline-alerts-flushed' }));
  }
}

// ─── Background Sync ───────────────────────────
self.addEventListener('sync', (event) => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(replayQueuedAlerts());
  }
});

// Allow the page to ask the SW to try flushing immediately (e.g. right
// after it detects 'online' but before a sync event has fired).
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'flush-offline-alerts') {
    event.waitUntil ? event.waitUntil(replayQueuedAlerts()) : replayQueuedAlerts();
  }
});
