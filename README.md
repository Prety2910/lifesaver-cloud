# 🚨 LifeSaver Cloud

A cloud-based emergency alert web application that helps users quickly send SOS alerts with live location to their emergency contacts.

---

## 🌐 Live Demo
👉 https://lifesaver-cloud.web.app

---

## ✨ Features

- 🔐 User Authentication (Firebase Auth)
- 📍 Real-time Location Tracking (Google Maps API)
- 🚨 SOS Emergency Alert System
- 📲 WhatsApp Integration for instant alerts
- 🔊 Siren + Button Animation for emergency trigger
- 👥 Emergency Contact Management
- 🗄️ Cloud Database (Firestore)
- 📜 Alert History Tracking
- 🌍 Deployed using Firebase Hosting

---

## 🛠️ Tech Stack

- HTML, CSS, JavaScript
- Firebase Authentication
- Cloud Firestore
- Google Maps JavaScript API
- Firebase Hosting

---

## 🚀 How it Works

1. User logs in / signs up
2. Adds emergency contacts
3. System fetches live location
4. On pressing SOS:
   - Siren is triggered
   - Location is captured
   - Alert message is generated
   - WhatsApp opens with pre-filled message
   - Alert is stored in Firestore

---

## 📁 Project Structure
├── index.html
├── style.css
├── app.js
├── firebase-config.js
├── siren.mp3
