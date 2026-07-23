/* ═══════════════════════════════════════════════
   LifeSaver Cloud – firebase-config.js
═══════════════════════════════════════════════ */

const firebaseConfig = {
  apiKey: "AIzaSyAUVrkqQ-_f3bm0sNZDukkgzJdkYgYSdeA",
  authDomain: "lifesaver-cloud.firebaseapp.com",
  projectId: "lifesaver-cloud",
  storageBucket: "lifesaver-cloud.firebasestorage.app",
  messagingSenderId: "525052016690",
  appId: "1:525052016690:web:e144bda9ab58ea5291242b",
  measurementId: "G-BVX758S87W"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// ─── FCM (Feature 3) ───────────────────────────
// Replace with your project's Web Push certificate key from
// Firebase Console → Project Settings → Cloud Messaging → Web Push certificates.
// Push notifications silently no-op until this is set — see README.md.
const FCM_VAPID_KEY = 'REPLACE_WITH_YOUR_VAPID_PUBLIC_KEY';

let messaging = null;
try {
  if (firebase.messaging && (!firebase.messaging.isSupported || firebase.messaging.isSupported())) {
    messaging = firebase.messaging();
  }
} catch (err) {
  console.warn('FCM unsupported in this browser:', err);
  messaging = null;
}
