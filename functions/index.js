/**
 * LifeSaver Cloud – Firebase Cloud Functions
 *
 * Requires the Blaze (pay-as-you-go) plan — outbound calls to Twilio and
 * the Claude API are not permitted on the free Spark plan. Secrets are
 * configured via `firebase functions:secrets:set` (see README.md) rather
 * than the deprecated `functions.config()`, which Firebase has sunset.
 *
 *   firebase deploy --only functions
 */

const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const twilio = require('twilio');
const nodemailer = require('nodemailer');
const Anthropic = require('@anthropic-ai/sdk');

admin.initializeApp();
const db = admin.firestore();
const messaging = admin.messaging();

// ─── Secrets ───────────────────────────────────
// Set with:
//   firebase functions:secrets:set TWILIO_ACCOUNT_SID
//   firebase functions:secrets:set TWILIO_AUTH_TOKEN
//   firebase functions:secrets:set TWILIO_PHONE_NUMBER
//   firebase functions:secrets:set EMAIL_USER
//   firebase functions:secrets:set EMAIL_PASS
//   firebase functions:secrets:set ANTHROPIC_API_KEY
const TWILIO_ACCOUNT_SID = defineSecret('TWILIO_ACCOUNT_SID');
const TWILIO_AUTH_TOKEN = defineSecret('TWILIO_AUTH_TOKEN');
const TWILIO_PHONE_NUMBER = defineSecret('TWILIO_PHONE_NUMBER');
const EMAIL_USER = defineSecret('EMAIL_USER');
const EMAIL_PASS = defineSecret('EMAIL_PASS');
const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');

// ─── Helpers ───────────────────────────────────
function normalizePhone(phone) {
  const raw = String(phone || '').trim();
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  if (raw.startsWith('+')) return `+${digits}`;
  if (digits.length === 10) return `+91${digits}`; // bare 10-digit fallback (India)
  return `+${digits}`;
}

async function sendTwilioSms(contactDocs, userName, mapsLink) {
  const sid = TWILIO_ACCOUNT_SID.value();
  const authToken = TWILIO_AUTH_TOKEN.value();
  const from = TWILIO_PHONE_NUMBER.value();

  if (!sid || !authToken || !from) {
    logger.warn('Twilio secrets not configured — skipping SMS fan-out.');
    return;
  }

  const client = twilio(sid, authToken);
  const body = `🚨 EMERGENCY ALERT: ${userName} needs help!${mapsLink ? ` Live location: ${mapsLink}` : ''} — sent via LifeSaver Cloud.`;

  await Promise.all(contactDocs.map(async (doc) => {
    const contact = doc.data();
    const to = normalizePhone(contact.phone);
    if (!to) return;
    try {
      await client.messages.create({ body, from, to });
      logger.info(`SMS sent to ${to}`);
    } catch (err) {
      logger.error(`Twilio SMS failed for ${to}:`, err.message);
    }
  }));
}

async function sendContactEmails(contactDocs, userName, mapsLink, lat, lng) {
  const user = EMAIL_USER.value();
  const pass = EMAIL_PASS.value();
  if (!user || !pass) {
    logger.warn('Email secrets not configured — skipping email fan-out.');
    return;
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass }
  });

  await Promise.all(contactDocs.map(async (doc) => {
    const contact = doc.data();
    if (!contact.email) return;

    const mailOptions = {
      from: `"LifeSaver Cloud" <${user}>`,
      to: contact.email,
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
              ${mapsLink ? `<a href="${mapsLink}" style="color:#e8192c;margin-top:8px;display:inline-block;font-size:14px;">📍 View on Google Maps →</a>` : ''}
            </div>
            <p style="color:#8891a4;font-size:12px;margin-bottom:0;">
              This alert was sent automatically by LifeSaver Cloud. Time: ${new Date().toLocaleString()}
            </p>
          </div>
        </div>
      `
    };

    try {
      await transporter.sendMail(mailOptions);
      logger.info(`Email sent to ${contact.email}`);
    } catch (err) {
      logger.error(`Email failed for ${contact.email}:`, err.message);
    }
  }));
}

async function sendFcmToTokens(tokens, data) {
  if (!tokens.length) return;
  try {
    const response = await messaging.sendEachForMulticast({
      tokens,
      data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)]))
    });
    response.responses.forEach((r, i) => {
      if (!r.success) logger.error(`FCM send failed for token ${tokens[i]}:`, r.error && r.error.message);
    });
  } catch (err) {
    logger.error('FCM multicast error:', err);
  }
}

async function sendGroupPush(uid, userName, mapsLink) {
  const groupMetaDoc = await db.collection('users').doc(uid).collection('meta').doc('group').get();
  if (!groupMetaDoc.exists) return;

  const code = groupMetaDoc.data().code;
  const groupSnap = await db.collection('groups').doc(code).get();
  if (!groupSnap.exists) return;

  const members = groupSnap.data().members || {};
  const memberUids = Object.keys(members).filter((m) => m !== uid);
  if (!memberUids.length) return;

  const tokenSnaps = await Promise.all(
    memberUids.map((mUid) => db.collection('users').doc(mUid).collection('tokens').get())
  );
  const tokens = tokenSnaps.flatMap((snap) => snap.docs.map((d) => d.id));
  if (!tokens.length) return;

  await sendFcmToTokens(tokens, {
    type: 'sos',
    title: `🚨 ${userName} needs help!`,
    body: mapsLink ? 'Tap to view their live location.' : 'Emergency SOS triggered — check on them now.',
    url: mapsLink || './',
    tag: `sos-${uid}`
  });
}

// ─── Feature 1 + 3: SOS trigger → SMS + email + FCM ───
exports.onNewAlert = onDocumentCreated(
  {
    document: 'users/{uid}/alerts/{alertId}',
    secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER, EMAIL_USER, EMAIL_PASS]
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const alert = snap.data();
    const uid = event.params.uid;
    const lat = alert.lat;
    const lng = alert.lng;
    const mapsLink = (lat && lng) ? `https://maps.google.com/?q=${lat},${lng}` : null;

    logger.info(`🚨 New SOS alert from user ${uid} (source: ${alert.source || 'manual'})`);

    const [profileDoc, contactsSnap] = await Promise.all([
      db.collection('users').doc(uid).collection('meta').doc('profile').get(),
      db.collection('users').doc(uid).collection('contacts').get()
    ]);

    const userName = (profileDoc.exists && profileDoc.data().name) || 'A LifeSaver user';

    await Promise.all([
      sendTwilioSms(contactsSnap.docs, userName, mapsLink),
      sendContactEmails(contactsSnap.docs, userName, mapsLink, lat, lng),
      sendGroupPush(uid, userName, mapsLink)
    ]);

    await snap.ref.update({
      status: 'notified',
      notifiedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    logger.info(`✅ Alert processing complete for user ${uid}`);
  }
);

// ─── Feature 8: AI-powered check-in classification ────
exports.classifyCheckin = onCall(
  { secrets: [ANTHROPIC_API_KEY] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'You must be logged in to submit a check-in.');
    }

    const uid = request.auth.uid;
    const message = String((request.data && request.data.message) || '').trim().slice(0, 2000);
    if (!message) {
      throw new HttpsError('invalid-argument', 'A check-in message is required.');
    }

    const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });

    let sentiment = 'SAFE';
    let reason = null;

    try {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 200,
        output_config: { effort: 'low' },
        system: 'You are a safety triage classifier for an emergency-alert app. Classify the sentiment of a ' +
          'user\'s daily wellbeing check-in message into exactly one of SAFE, CONCERNED, or DISTRESS. ' +
          'SAFE: the user is fine or in good spirits. CONCERNED: the user mentions feeling unwell, stressed, ' +
          'sad, or a minor issue but is not in danger. DISTRESS: the user indicates a medical emergency, ' +
          'being in danger, being unable to get help, or a serious crisis. Always call the classify_checkin ' +
          'tool with your classification — never respond in plain text.',
        tools: [{
          name: 'classify_checkin',
          description: 'Record the sentiment classification of a user\'s daily safety check-in message.',
          input_schema: {
            type: 'object',
            properties: {
              sentiment: { type: 'string', enum: ['SAFE', 'CONCERNED', 'DISTRESS'] },
              reason: { type: 'string', description: 'One short sentence explaining the classification.' }
            },
            required: ['sentiment']
          }
        }],
        tool_choice: { type: 'tool', name: 'classify_checkin' },
        messages: [{ role: 'user', content: message }]
      });

      const toolUse = response.content.find((block) => block.type === 'tool_use');
      if (toolUse && toolUse.input && toolUse.input.sentiment) {
        sentiment = toolUse.input.sentiment;
        reason = toolUse.input.reason || null;
      }
    } catch (err) {
      logger.error('Claude classify_checkin error:', err);
      // Fail safe: default to SAFE rather than silently dropping the check-in.
    }

    const now = admin.firestore.FieldValue.serverTimestamp();

    await db.collection('users').doc(uid).collection('checkins').add({
      message, sentiment, reason, timestamp: now
    });
    await db.collection('users').doc(uid).collection('meta').doc('lastCheckin').set({
      status: sentiment, message, timestamp: now
    });

    if (sentiment === 'DISTRESS') {
      const locDoc = await db.collection('users').doc(uid).collection('meta').doc('location').get();
      const loc = locDoc.exists ? locDoc.data() : {};

      await db.collection('users').doc(uid).collection('alerts').add({
        lat: loc.lat || null,
        lng: loc.lng || null,
        message: `🤖 AI check-in flagged DISTRESS: "${message}"`,
        contacts: [],
        status: 'ai-triggered',
        source: 'ai-checkin',
        timestamp: now
      });
      // onNewAlert (above) fires automatically on this write and handles
      // SMS + email + FCM fan-out — no need to duplicate that here.
    }

    return { sentiment, reason };
  }
);

// ─── Feature 8: daily check-in reminder (Firebase Scheduler) ──
exports.dailyCheckinReminder = onSchedule(
  { schedule: '0 9 * * *', timeZone: 'Asia/Kolkata' },
  async () => {
    const usersSnap = await db.collection('users').get();

    const tokenLists = await Promise.all(
      usersSnap.docs.map(async (userDoc) => {
        const tokensSnap = await userDoc.ref.collection('tokens').get();
        return tokensSnap.docs.map((d) => d.id);
      })
    );

    const allTokens = tokenLists.flat();
    if (!allTokens.length) {
      logger.info('No FCM tokens registered — skipping daily check-in reminder.');
      return;
    }

    await sendFcmToTokens(allTokens, {
      type: 'checkin-reminder',
      title: '🤖 Daily Safety Check-in',
      body: 'How are you doing today? Tap to let your family know you\'re safe.',
      url: './',
      tag: 'daily-checkin'
    });

    logger.info(`Sent daily check-in reminder to ${allTokens.length} device(s).`);
  }
);
