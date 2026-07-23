/* ═══════════════════════════════════════════════
   LifeSaver Cloud – pwa.js
   PWA install prompt, offline banner, and the
   IndexedDB-backed offline SOS queue (Feature 7).
═══════════════════════════════════════════════ */

(function () {
  const DB_NAME = 'lifesaver-offline';
  const DB_STORE = 'pending-alerts';
  const SYNC_TAG = 'sync-sos-alerts';

  let deferredInstallPrompt = null;
  let swRegistration = null;
  let fcmSwRegistration = null;

  // ─── IndexedDB helpers (mirrors sw.js) ───────
  function openDB() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error('IndexedDB unsupported'));
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

  async function addPending(entry) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
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

  // ─── Service worker registration ─────────────
  async function registerServiceWorkers() {
    if (!('serviceWorker' in navigator)) return;

    try {
      swRegistration = await navigator.serviceWorker.register('./sw.js');
    } catch (err) {
      console.error('sw.js registration failed:', err);
    }

    try {
      fcmSwRegistration = await navigator.serviceWorker.register('./firebase-messaging-sw.js');
    } catch (err) {
      console.error('firebase-messaging-sw.js registration failed:', err);
    }

    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'offline-alerts-flushed') {
        if (typeof window.loadHistory === 'function') window.loadHistory();
        if (typeof window.showToast === 'function') window.showToast('✅ Queued offline alert(s) sent');
      }
    });
  }

  function getFcmServiceWorkerRegistration() {
    return fcmSwRegistration;
  }

  // ─── Offline SOS queue ────────────────────────
  async function queueOfflineAlert(uid, idToken, payload) {
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      uid,
      idToken,
      payload: { ...payload, queuedAt: new Date().toISOString() }
    };

    await addPending(entry);

    if (swRegistration && 'sync' in swRegistration) {
      try {
        await swRegistration.sync.register(SYNC_TAG);
      } catch (err) {
        // Background Sync unsupported/denied — the 'online' listener below
        // is the fallback flush path.
      }
    }

    return entry.id;
  }

  // Primary flush path: runs in the main thread with a live, auto-refreshing
  // Firestore SDK session, so it doesn't depend on a possibly-stale ID token
  // the way the service worker's REST-based replay does.
  async function flushOfflineAlertsIfOnline() {
    if (!navigator.onLine) return;
    if (typeof firebase === 'undefined' || !firebase.auth().currentUser) return;

    const pending = await getAllPending().catch(() => []);
    if (!pending.length) return;

    const db = firebase.firestore();
    let flushedAny = false;

    for (const entry of pending) {
      try {
        await db.collection('users').doc(entry.uid).collection('alerts').add({
          lat: entry.payload.lat || null,
          lng: entry.payload.lng || null,
          message: entry.payload.message || '',
          status: 'offline-sync',
          source: entry.payload.source || 'offline-queue',
          contacts: entry.payload.contacts || [],
          timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
        await deletePending(entry.id);
        flushedAny = true;
      } catch (err) {
        console.error('Failed to flush queued alert:', err);
      }
    }

    if (flushedAny) {
      if (typeof window.loadHistory === 'function') window.loadHistory();
      if (typeof window.showToast === 'function') window.showToast('✅ Queued offline alert(s) sent');
    }
  }

  async function pendingOfflineAlertCount() {
    const pending = await getAllPending().catch(() => []);
    return pending.length;
  }

  // ─── Offline banner ────────────────────────────
  function initOfflineBanner() {
    let banner = document.getElementById('offlineBanner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'offlineBanner';
      banner.className = 'offline-banner hidden';
      banner.innerHTML = `<span>📡 You're offline — SOS alerts will be queued and sent automatically once you're back online.</span>`;
      document.body.prepend(banner);
    }

    function update() {
      if (navigator.onLine) {
        banner.classList.add('hidden');
        flushOfflineAlertsIfOnline();
        navigator.serviceWorker?.controller?.postMessage({ type: 'flush-offline-alerts' });
      } else {
        banner.classList.remove('hidden');
      }
    }

    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    update();
  }

  // ─── Install prompt ────────────────────────────
  function initInstallButton() {
    const btn = document.getElementById('installAppBtn');
    if (!btn) return;

    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      deferredInstallPrompt = event;
      btn.classList.remove('hidden');
    });

    window.addEventListener('appinstalled', () => {
      deferredInstallPrompt = null;
      btn.classList.add('hidden');
    });

    btn.addEventListener('click', async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      btn.classList.add('hidden');
    });

    if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone) {
      btn.classList.add('hidden');
    }
  }

  function init() {
    registerServiceWorkers();
    initOfflineBanner();
    initInstallButton();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.LifeSaverPWA = {
    queueOfflineAlert,
    flushOfflineAlertsIfOnline,
    pendingOfflineAlertCount,
    getFcmServiceWorkerRegistration
  };
})();
