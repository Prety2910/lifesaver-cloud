/* ═══════════════════════════════════════════════
   LifeSaver Cloud – firebase-messaging-sw.js
   FCM background-push service worker.
   Must live at the site root (not under /js) so its
   default scope covers the whole origin.
═══════════════════════════════════════════════ */

importScripts('https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js');
importScripts('https://www.gstatic.com/firebasejs/8.10.1/firebase-messaging.js');

firebase.initializeApp({
  apiKey: "AIzaSyAUVrkqQ-_f3bm0sNZDukkgzJdkYgYSdeA",
  authDomain: "lifesaver-cloud.firebaseapp.com",
  projectId: "lifesaver-cloud",
  storageBucket: "lifesaver-cloud.firebasestorage.app",
  messagingSenderId: "525052016690",
  appId: "1:525052016690:web:e144bda9ab58ea5291242b"
});

const messaging = firebase.messaging();

// Background messages (tab closed / not focused) — Cloud Functions send a
// data-only payload so we fully control the notification here.
messaging.onBackgroundMessage((payload) => {
  const data = payload.data || {};
  const isSOS = data.type === 'sos';

  const title = data.title || (isSOS ? '🚨 Emergency Alert' : 'LifeSaver Cloud');
  const options = {
    body: data.body || 'Tap to view details.',
    icon: './icons/icon.svg',
    badge: './icons/icon.svg',
    tag: data.tag || 'lifesaver-notification',
    requireInteraction: isSOS,
    vibrate: isSOS ? [300, 100, 300, 100, 300] : [100],
    data: {
      url: data.url || './'
    }
  };

  self.registration.showNotification(title, options);
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || './';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});
