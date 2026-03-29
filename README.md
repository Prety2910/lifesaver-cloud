# 🛡 LifeSaver Cloud – Smart Emergency Alert System

A cloud-based emergency alert system built with HTML/CSS/JavaScript, Firebase, and Google Maps API.

---

## 📁 Folder Structure

```
lifesaver-cloud/
│
├── public/                    ← Frontend (hosted on Firebase Hosting)
│   ├── index.html             ← Single-page app structure
│   ├── css/
│   │   └── style.css          ← All styles (dark medical-grade UI)
│   └── js/
│       ├── firebase-config.js ← Firebase credentials (you fill this)
│       └── app.js             ← All JavaScript logic
│
├── functions/                 ← Backend (Firebase Cloud Functions)
│   ├── index.js               ← Alert trigger + email sender
│   └── package.json           ← Node.js dependencies
│
├── firebase.json              ← Firebase hosting + functions config
├── firestore.rules            ← Database security rules
├── firestore.indexes.json     ← Database indexes for queries
└── README.md                  ← This file
```

---

## 🏗 Architecture (Simple Explanation)

```
User's Browser
  │
  ├── HTML/CSS/JS (Frontend)
  │     ├── Google Maps API → Shows live location on map
  │     ├── Geolocation API → Gets GPS coordinates
  │     └── Firebase SDK   → Talks to database
  │
  └── Firebase (Backend/Cloud)
        ├── Firebase Hosting     → Serves your website
        ├── Firestore Database   → Stores contacts, alerts, profiles
        └── Cloud Functions      → Sends email alerts automatically
                                    (triggers when alert is created)
```

**Data flow when SOS is pressed:**
1. User presses panic button → JavaScript gets GPS location
2. Alert record saved to Firestore (database)
3. Cloud Function automatically triggers
4. Function fetches user's emergency contacts
5. Sends email to each contact with location link
6. Alert status updated to "notified"

---

## ⚙️ Step-by-Step Setup Guide

### Step 1: Create a Firebase Project
1. Go to https://console.firebase.google.com
2. Click **"Add project"** → name it `lifesaver-cloud`
3. Click through the setup (disable Google Analytics if you want to keep it simple)

### Step 2: Set up Firestore Database
1. In Firebase Console → left sidebar → **Firestore Database**
2. Click **"Create database"**
3. Choose **"Start in test mode"** (good for development)
4. Select a region close to you → **Enable**

### Step 3: Get Firebase Config
1. In Firebase Console → **Project Settings** (gear icon) → **General**
2. Scroll down to "Your apps" → click **"</> Web"**
3. Register the app with any nickname
4. Copy the `firebaseConfig` object
5. Paste it into `public/js/firebase-config.js`

### Step 4: Get Google Maps API Key
1. Go to https://console.cloud.google.com
2. Create a new project (or use existing)
3. Enable these APIs:
   - Maps JavaScript API
   - Geocoding API
4. Go to **Credentials** → **Create Credentials** → **API Key**
5. Copy the key
6. In `public/index.html`, replace `YOUR_GOOGLE_MAPS_API_KEY` with your key

### Step 5: Install Firebase CLI
```bash
# Install Node.js first from nodejs.org, then:
npm install -g firebase-tools

# Login to Firebase
firebase login
```

### Step 6: Initialize Firebase in your project folder
```bash
cd lifesaver-cloud
firebase init

# When prompted:
# ✅ Select: Hosting, Firestore, Functions
# ✅ Use existing project: lifesaver-cloud (your project)
# ✅ Public directory: public
# ✅ Single-page app: Yes
# ✅ Functions language: JavaScript
```

### Step 7: Set up Cloud Functions email
```bash
cd functions
npm install

# Set your email credentials (use Gmail App Password, not your real password)
# Go to: Google Account → Security → 2FA → App Passwords → Generate
firebase functions:config:set email.user="youremail@gmail.com" email.pass="your-app-password"
```

### Step 8: Deploy Everything
```bash
# From project root:
firebase deploy

# Or deploy parts separately:
firebase deploy --only hosting
firebase deploy --only functions
firebase deploy --only firestore:rules
```

### Step 9: Open your app
After deploy, Firebase gives you a URL like:
`https://lifesaver-cloud-xxxxx.web.app`

---

## 🔧 Local Development (Testing without deploying)

```bash
# Serve frontend locally
firebase serve --only hosting

# Test Cloud Functions locally
firebase emulators:start
```

---

## 📊 Firestore Collections Structure

```
/contacts/{docId}
  - name: "Mom"
  - phone: "+91 98765 43210"
  - email: "mom@example.com"
  - relation: "Family"
  - deviceId: "user_abc123"
  - createdAt: timestamp

/alerts/{docId}
  - deviceId: "user_abc123"
  - lat: 12.9716
  - lng: 77.5946
  - contacts: ["+91 98765 43210"]
  - timestamp: timestamp
  - status: "sent" | "notified"

/profiles/{deviceId}
  - name: "Alex"
  - phone: "+91 99999 00000"
  - medical: "Blood Group: O+"

/locations/{deviceId}
  - lat: 12.9716
  - lng: 77.5946
  - updatedAt: timestamp
```

---

## 🎤 How to Explain in Interviews

**Opening (30 seconds):**
> "I built LifeSaver Cloud, a real-time emergency alert system that lets users send SOS alerts with their live GPS location to pre-saved emergency contacts. It's a full-stack web app using Firebase for the backend and Google Maps for location services."

**Technical explanation:**
> "The frontend is plain HTML, CSS, and JavaScript — a single-page application with four views. When a user hits the SOS button, the browser's Geolocation API captures coordinates, which I save to a Firestore database. I then wrote a Firebase Cloud Function that listens for new alert documents and automatically sends emails to all the user's contacts with a Google Maps link to their location."

**If asked about challenges:**
> "The main challenge was handling offline scenarios — when Firestore isn't connected, I fall back to localStorage so the app doesn't break. I also had to style Google Maps with a custom dark theme using the Styled Maps API to match the UI."

**If asked about architecture:**
> "I chose Firebase because it handles authentication, database, hosting, and serverless functions in one platform — ideal for a beginner project. The architecture is event-driven: the Cloud Function triggers automatically on a Firestore document creation, which is a common serverless pattern."

---

## 🚀 Possible Improvements (mention in interview)

1. **SMS Alerts via Twilio** — Currently sends email; could add SMS using Twilio API for faster alerting
2. **User Authentication** — Add Firebase Auth so multiple family members share one account
3. **Live Location Tracking** — Stream GPS coordinates every 30 seconds during an emergency
4. **Push Notifications** — Use Firebase Cloud Messaging (FCM) to send push alerts to contacts' phones
5. **SOS Countdown** — Add a 5-second cancel window before the alert fires (prevents false alarms)
6. **PWA (Progressive Web App)** — Make it installable on mobile phones like a native app
7. **Wearable Integration** — Connect to smartwatch to detect falls and auto-trigger
8. **Multi-language support** — Serve users globally with i18n

---

## 📦 Tech Stack Summary

| Layer      | Technology         | Purpose                        |
|------------|--------------------|--------------------------------|
| Frontend   | HTML, CSS, JS      | User interface                 |
| Maps       | Google Maps JS API | Live location display          |
| Database   | Firebase Firestore | Store contacts, alerts, users  |
| Backend    | Firebase Functions | Send email alerts (Node.js)    |
| Hosting    | Firebase Hosting   | Deploy the website to cloud    |
| Email      | Nodemailer/Gmail   | Send emergency emails          |

---

*Built as a beginner cloud project — demonstrates real-time database, serverless functions, cloud hosting, and third-party API integration.*
