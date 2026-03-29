/**
 * LifeSaver Cloud – Firebase Cloud Functions
 * 
 * This backend function triggers automatically whenever a new
 * alert is saved to the Firestore 'alerts' collection.
 * It then sends SMS/email to all emergency contacts.
 *
 * HOW TO DEPLOY:
 *   1. npm install -g firebase-tools
 *   2. firebase login
 *   3. firebase init functions  (choose JavaScript)
 *   4. Copy this code into functions/index.js
 *   5. firebase deploy --only functions
 */

const functions  = require('firebase-functions');
const admin      = require('firebase-admin');
const nodemailer = require('nodemailer');

admin.initializeApp();
const db = admin.firestore();

// ─── Email transporter (Gmail example) ────────
// In production: use SendGrid, Mailgun, or AWS SES instead.
// Store credentials in Firebase environment config:
//   firebase functions:config:set email.user="you@gmail.com" email.pass="yourpassword"
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: functions.config().email?.user || 'YOUR_EMAIL@gmail.com',
    pass: functions.config().email?.pass || 'YOUR_APP_PASSWORD',
  }
});

// ─── Trigger: New Alert Created ───────────────
exports.onNewAlert = functions.firestore
  .document('alerts/{alertId}')
  .onCreate(async (snap, context) => {

    const alert    = snap.data();
    const deviceId = alert.deviceId;
    const lat      = alert.lat;
    const lng      = alert.lng;
    const mapsLink = lat && lng
      ? `https://maps.google.com/?q=${lat},${lng}`
      : 'Location unavailable';

    console.log(`🚨 New SOS alert from device: ${deviceId}`);

    // 1. Fetch this user's contacts
    const contactsSnap = await db.collection('contacts')
      .where('deviceId', '==', deviceId).get();

    if (contactsSnap.empty) {
      console.log('No contacts found for this user.');
      return null;
    }

    // 2. Fetch user's profile
    let userName = 'Someone';
    try {
      const profileDoc = await db.collection('profiles').doc(deviceId).get();
      if (profileDoc.exists) userName = profileDoc.data().name || 'Someone';
    } catch (e) { /* ignore */ }

    // 3. Send email to each contact
    const emailPromises = contactsSnap.docs.map(async doc => {
      const contact = doc.data();
      if (!contact.email) return; // Skip contacts without email

      const mailOptions = {
        from:    `"LifeSaver Cloud" <${functions.config().email?.user}>`,
        to:       contact.email,
        subject: `🚨 EMERGENCY ALERT from ${userName}`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;background:#0a0c10;color:#e8eaf0;border-radius:12px;overflow:hidden;">
            <div style="background:#e8192c;padding:24px;text-align:center;">
              <h1 style="margin:0;color:#fff;font-size:28px;">🛡 LifeSaver Cloud</h1>
              <p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">EMERGENCY ALERT</p>
            </div>
            <div style="padding:32px;">
              <h2 style="color:#e8192c;margin-top:0;">🚨 ${userName} needs help!</h2>
              <p style="color:#8891a4;line-height:1.6;">
                <strong style="color:#e8eaf0;">${userName}</strong> has triggered an emergency SOS alert. 
                Please check on them immediately or contact emergency services.
              </p>
              <div style="background:#181c23;border:1px solid #1f2430;border-radius:8px;padding:16px;margin:20px 0;">
                <p style="margin:0 0 8px;font-size:12px;color:#8891a4;text-transform:uppercase;letter-spacing:0.1em;">Last Known Location</p>
                <p style="margin:0;font-size:16px;">${lat ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : 'Unavailable'}</p>
                ${lat ? `<a href="${mapsLink}" style="color:#e8192c;margin-top:8px;display:inline-block;font-size:14px;">📍 View on Google Maps →</a>` : ''}
              </div>
              <p style="color:#8891a4;font-size:12px;margin-bottom:0;">
                This alert was sent automatically by LifeSaver Cloud emergency system.
                Time: ${new Date().toLocaleString()}
              </p>
            </div>
          </div>
        `
      };

      try {
        await transporter.sendMail(mailOptions);
        console.log(`✅ Email sent to ${contact.email}`);
      } catch (err) {
        console.error(`❌ Failed to email ${contact.email}:`, err.message);
      }
    });

    await Promise.all(emailPromises);

    // 4. Update alert status
    await snap.ref.update({ status: 'notified', notifiedAt: admin.firestore.FieldValue.serverTimestamp() });

    console.log(`✅ Alert processing complete for device: ${deviceId}`);
    return null;
  });

// ─── HTTP endpoint (optional REST API) ────────
// Call this from frontend for extra flexibility:
//   fetch('https://YOUR_REGION-YOUR_PROJECT.cloudfunctions.net/sendAlert', {...})
exports.sendAlert = functions.https.onRequest(async (req, res) => {
  // Set CORS headers
  res.set('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'POST');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.status(204).send('');
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { deviceId, lat, lng } = req.body;
    if (!deviceId) {
      res.status(400).json({ error: 'deviceId is required' });
      return;
    }

    // Create alert document (triggers the Firestore function above)
    const alertRef = await db.collection('alerts').add({
      deviceId, lat, lng,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      status: 'pending'
    });

    res.status(200).json({ success: true, alertId: alertRef.id });
  } catch (err) {
    console.error('sendAlert error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
