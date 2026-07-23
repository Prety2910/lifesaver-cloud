# 🚨 LifeSaver Cloud

A cloud-based emergency alert web application — SOS button, live location, family safety groups, fall/shake detection, offline support, and an AI-powered daily check-in.

---

> ### 📌 Portfolio Note
> The full Twilio and FCM integration is built in the Cloud Functions — I haven't connected live credentials since this is a portfolio project, but the architecture is production-ready. In a real deployment you'd set the secrets via Firebase Secret Manager and upgrade to the Blaze plan for outbound network calls.

---

## 🌐 Live Demo
https://lifesaver-cloud.vercel.app/

> **Note:** This upgrade moves the backend (Twilio SMS, email, FCM push, Claude AI check-ins) onto **Firebase Cloud Functions**. The old Vercel `api/send-sms.js` endpoint is left in the repo but is no longer called by the app — see "Architecture change" below.

---

## ✨ Features

- 🔐 Firebase Email/Password Authentication
- 📍 Real-time location tracking (Google Maps API)
- 🚨 SOS alert with a 5-second cancel countdown (shrinking conic-gradient ring)
- 📲 Twilio SMS to every emergency contact, sent from a Cloud Function
- ✉️ Email alerts to contacts with an email on file
- 🔔 Browser push notifications (FCM) to family group members, even with the tab closed
- 🤸 Fall detection via `devicemotion` — "Are you okay?" 10s countdown before auto-SOS
- 📳 Shake-to-SOS — 3 shakes in 2s triggers the SOS countdown, with a sensitivity setting
- 📈 Live accelerometer graph (Chart.js) on the dashboard
- 👪 Family Safety Group — join with a 6-digit code, see everyone's live location on the map, any member's SOS notifies the whole group
- 📶 Offline-first PWA — installable, caches the app shell, queues SOS alerts in IndexedDB and replays them via Background Sync when back online
- 🤖 Daily AI safety check-in — a short message is classified as SAFE / CONCERNED / DISTRESS by Claude; DISTRESS auto-triggers the SOS flow
- 🗄️ Cloud Firestore for contacts, alerts, groups, tokens, and check-in history
- 📜 Alert history with source tagging (manual / fall / shake / AI check-in)

---

## 🛠️ Tech Stack

- HTML, CSS, vanilla JavaScript (Firebase JS SDK v8, compat build)
- Firebase Authentication, Cloud Firestore, Firebase Hosting, Cloud Functions (2nd gen), Cloud Messaging
- Google Maps JavaScript API
- Chart.js (accelerometer graph)
- Twilio Node SDK (SMS)
- Anthropic Claude API (`claude-sonnet-4-6`) for check-in sentiment classification
- Service workers for offline caching + FCM background push

---

## 📁 Project Structure

```
public/                     ← Firebase Hosting root
  index.html
  tracking.html
  manifest.json              (PWA manifest)
  sw.js                      (offline cache + Background Sync queue)
  firebase-messaging-sw.js   (FCM background push)
  icons/icon.svg
  css/style.css
  js/
    firebase-config.js
    app.js
    motion-detection.js      (fall + shake detection, Chart.js graph)
    ai-checkin.js            (daily check-in widget)
    pwa.js                   (install prompt, offline banner, IndexedDB queue)
functions/
  index.js                   (Twilio SMS, email, FCM, Claude classifier, scheduler)
  package.json
firestore.rules
firestore.indexes.json
firebase.json
.firebaserc
api/send-sms.js              (legacy Vercel endpoint — unused, kept for reference)
vercel.json
```

### Architecture change: Vercel → Firebase Functions

The original app sent Twilio SMS from a Vercel serverless function (`api/send-sms.js`), called directly from the browser. This upgrade moves that logic server-side into `functions/onNewAlert`, which fires automatically whenever a new document is created in `users/{uid}/alerts`. This is required so the same trigger can also fan out to email and FCM push, and so the Twilio credentials never touch client-side code. `api/send-sms.js` and `vercel.json` are left in the repo untouched but the app no longer calls them — you can safely stop the Vercel deployment, or keep it purely as a static mirror.

---

## 🚀 Setup

### 1. Firebase project (Blaze plan required)

Twilio and Claude API calls are outbound network requests, which **Cloud Functions only allow on the Blaze (pay-as-you-go) plan** — Blaze still has a generous free tier, but requires a credit card on file.

```bash
npm install -g firebase-tools
firebase login
firebase use lifesaver-cloud   # or your own project id in .firebaserc
```

### 2. Install function dependencies

```bash
cd functions
npm install
cd ..
```

### 3. Configure secrets (replaces the deprecated `functions:config:set`)

`firebase functions:config:set` has been **shut down by Firebase** in favor of Secret Manager–backed secrets. Set each one with:

```bash
firebase functions:secrets:set TWILIO_ACCOUNT_SID
firebase functions:secrets:set TWILIO_AUTH_TOKEN
firebase functions:secrets:set TWILIO_PHONE_NUMBER
firebase functions:secrets:set EMAIL_USER
firebase functions:secrets:set EMAIL_PASS
firebase functions:secrets:set ANTHROPIC_API_KEY
```

Each command prompts for the secret value and stores it in Google Secret Manager; `functions/index.js` reads them via `defineSecret(...)`. Values:

| Secret | Where to get it |
|---|---|
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | Twilio Console → Account → API keys & tokens |
| `TWILIO_PHONE_NUMBER` | A Twilio phone number capable of sending SMS, in `+1XXXXXXXXXX` format |
| `EMAIL_USER` / `EMAIL_PASS` | A Gmail address + [App Password](https://myaccount.google.com/apppasswords) (not your normal password) |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) → API Keys |

### 4. FCM Web Push certificate (VAPID key)

Feature 3 (browser push) needs a VAPID key pair:

1. Firebase Console → Project Settings → **Cloud Messaging** → **Web Push certificates** → Generate key pair.
2. Copy the key into `public/js/firebase-config.js`:
   ```js
   const FCM_VAPID_KEY = 'paste-your-key-here';
   ```

Without this, "Enable Push Notifications" fails gracefully with a toast — everything else still works.

### 5. Deploy

```bash
firebase deploy --only firestore:rules,firestore:indexes,functions,hosting
```

---

## 📲 Feature notes

**SOS countdown (Feature 2).** Tapping the SOS button starts a 5-second countdown drawn as a shrinking `conic-gradient` ring; tapping again cancels it (with a short vibration on supported devices). Only after the full 5 seconds does `triggerAlert()` actually fire.

**Fall detection (Feature 4).** Listens to `devicemotion`; a spike over 25 m/s² followed within 1.5s by near-stillness (< 3 m/s²) opens a fullscreen "Are you okay?" modal with a 10-second countdown. No response auto-sends the SOS. iOS 13+ requires the "Enable Fall & Shake Detection" button to be tapped once (motion permission needs a user gesture).

**Shake-to-SOS (Feature 5).** Three shakes within 2 seconds re-uses the same 5-second SOS countdown from Feature 2. Toggle and sensitivity (Low/Medium/High) live under Profile → Settings, stored in `localStorage`.

**Family groups (Feature 6).** Create a group to get a 6-digit code, or join one with a code someone shares with you. Every member's location is written to `groups/{code}/locations/{uid}` and rendered as a colored marker on the dashboard map. Any member's SOS writes to `groups/{code}/alerts` (for an instant in-app toast to anyone with the app open) and triggers FCM push to the rest of the group via the Cloud Function.

**Offline PWA (Feature 7).** `sw.js` caches the app shell for offline use. If you trigger SOS while offline, the alert is written to an IndexedDB queue and a Background Sync (`sync-sos-alerts`) is registered; the service worker replays it via the Firestore REST API once connectivity returns. The main app also flushes the same queue directly through the Firestore SDK on the `online` event, which is the more reliable path on browsers without Background Sync support (e.g. Safari/iOS).

**AI check-in (Feature 8).** Once a day the app prompts "How are you doing today?". The message is sent to a `classifyCheckin` Cloud Function (never exposing the Anthropic key to the browser), which calls Claude (`claude-sonnet-4-6`) with a forced tool call to classify SAFE / CONCERNED / DISTRESS. DISTRESS writes a new alert document, which the same `onNewAlert` trigger picks up automatically.

---

## 🔒 Security notes

- `.env` at the repo root holds legacy Twilio values used only by the now-unused `api/send-sms.js`; it's `.gitignore`d and was never committed.
- All new secrets (Twilio, email, Anthropic) live in Cloud Functions Secret Manager, never in client-side code.
- Firestore rules scope every collection to `request.auth.uid`; family group docs are readable by any signed-in user (needed to validate a join code) but writes are restricted to the acting member's own fields.

---

## 📁 Legacy structure reference
├── public/index.html
├── public/css/style.css
├── public/js/app.js
├── public/js/firebase-config.js
├── functions/index.js
├── siren.mp3
