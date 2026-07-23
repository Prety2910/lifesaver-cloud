/* ═══════════════════════════════════════════════
   LifeSaver Cloud – app.js
═══════════════════════════════════════════════ */

let currentLat = null;
let currentLng = null;
let map = null;
let marker = null;
let contacts = [];
let alertsSent = 0;
let currentUser = null;

// Feature 6 — family group state
let currentGroupCode = null;
let currentGroupColor = null;
let groupDocUnsub = null;
let groupLocationsUnsub = null;
let groupAlertsUnsub = null;
let familyMarkers = {};
let groupAlertsSeen = new Set();
const GROUP_COLORS = ['#e8192c', '#00e676', '#00d4ff', '#f5a623', '#c74dff', '#ff6b9d', '#7fff00', '#4dd0e1'];

// Feature 2 — SOS countdown state
let countdownState = null;

// ─── Navigation ───────────────────────────────
document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', e => {
    e.preventDefault();
    navigateTo(link.dataset.page);
  });
});

function navigateTo(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));

  document.getElementById(pageId)?.classList.add('active');
  document.querySelector(`[data-page="${pageId}"]`)?.classList.add('active');

  if (pageId === 'contacts') renderContacts();
  if (pageId === 'history') loadHistory();
  if (pageId === 'profile') loadProfile();
  if (pageId === 'family') renderFamilyGroupUI();
}

// ─── Network / offline banner support ─────────
function updateNetworkStatus() {
  const el = document.getElementById('networkStatus');
  if (!el) return;
  el.textContent = navigator.onLine ? 'Online' : 'Offline';
}
window.addEventListener('online', updateNetworkStatus);
window.addEventListener('offline', updateNetworkStatus);

// ─── Auth ─────────────────────────────────────
firebase.auth().onAuthStateChanged(async user => {
  const authStatus = document.getElementById('authStatus');
  const authForm = document.getElementById('authForm');
  const loggedInBar = document.getElementById('loggedInBar');
  const loggedInText = document.getElementById('loggedInText');

  if (user) {
    currentUser = user;

    authStatus && (authStatus.textContent = `Logged in as ${user.email}`);
    authForm && authForm.classList.add('hidden');
    loggedInBar && loggedInBar.classList.remove('hidden');
    loggedInText && (loggedInText.textContent = `Welcome, ${user.email}`);

    await loadProfile();
    await loadContacts();
    await loadHistory();
    await loadGroupMembership();
    updateCounts();
    window.LifeSaverCheckin?.onLogin(user);
    if (typeof window.LifeSaverPWA !== 'undefined') window.LifeSaverPWA.flushOfflineAlertsIfOnline();
    showToast('✅ Logged in');
  } else {
    currentUser = null;
    contacts = [];
    alertsSent = 0;
    unsubscribeFromGroup();
    currentGroupCode = null;

    authStatus && (authStatus.textContent = 'Not logged in');
    authForm && authForm.classList.remove('hidden');
    loggedInBar && loggedInBar.classList.add('hidden');

    document.getElementById('userName').textContent = 'Buddy';
    document.getElementById('avatarInitial').textContent = 'B';
    document.getElementById('contactCount').textContent = '0';
    document.getElementById('alertCount').textContent = '0';

    renderContacts();
    window.LifeSaverCheckin?.onLogout();
    renderFamilyGroupUI();
    const historyList = document.getElementById('historyList');
    if (historyList) {
      historyList.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🔒</div>
          <p>Please log in to view your alert history.</p>
        </div>
      `;
    }
  }
});

function signup() {
  const email = document.getElementById('email')?.value.trim() || '';
  const password = document.getElementById('password')?.value.trim() || '';
  if (!email || !password) return showToast('⚠️ Enter email and password');

  firebase.auth()
    .createUserWithEmailAndPassword(email, password)
    .then(() => showToast('✅ Signed up successfully'))
    .catch(err => {
      console.error(err);
      showToast(`❌ ${err.message}`);
    });
}

function login() {
  const email = document.getElementById('email')?.value.trim() || '';
  const password = document.getElementById('password')?.value.trim() || '';
  if (!email || !password) return showToast('⚠️ Enter email and password');

  firebase.auth()
    .signInWithEmailAndPassword(email, password)
    .then(() => showToast('✅ Logged in successfully'))
    .catch(err => {
      console.error(err);
      showToast(`❌ ${err.message}`);
    });
}

function logout() {
  firebase.auth().signOut()
    .then(() => showToast('✅ Logged out'))
    .catch(err => {
      console.error(err);
      showToast(`❌ ${err.message}`);
    });
}

// ─── Maps / Location ──────────────────────────

// Lightweight custom marker (google.maps.OverlayView) so the user's own
// location can be rendered as a real DOM node with a CSS `@keyframes ping`
// animation — the built-in Marker/AdvancedMarkerElement classes don't
// expose their internals to CSS. Exposes the same setPosition({lat,lng})
// shape as google.maps.Marker so refreshLocation() doesn't need to care
// which one it's holding.
function createPulseMarker(position, mapInstance) {
  class PulseMarker extends google.maps.OverlayView {
    constructor(pos, m) {
      super();
      this.position = pos;
      this.div = null;
      this.setMap(m);
    }
    onAdd() {
      this.div = document.createElement('div');
      this.div.className = 'map-pulse-marker';
      this.div.innerHTML = '<span class="map-pulse-ring"></span><span class="map-pulse-dot"></span>';
      this.getPanes().overlayMouseTarget.appendChild(this.div);
    }
    draw() {
      const projection = this.getProjection();
      if (!projection || !this.div) return;
      const point = projection.fromLatLngToDivPixel(new google.maps.LatLng(this.position.lat, this.position.lng));
      if (point) {
        this.div.style.left = `${point.x}px`;
        this.div.style.top = `${point.y}px`;
      }
    }
    setPosition(pos) {
      this.position = pos;
      this.draw();
    }
    onRemove() {
      if (this.div) {
        this.div.remove();
        this.div = null;
      }
    }
  }

  return new PulseMarker(position, mapInstance);
}

function initMap() {
  const mapDiv = document.getElementById('map');
  if (!mapDiv) return;

  if (typeof google === 'undefined' || !google.maps) {
    showMapPlaceholder();
    return;
  }

  const defaultCoords = { lat: 12.9716, lng: 77.5946 };

  map = new google.maps.Map(mapDiv, {
    center: defaultCoords,
    zoom: 14,
    mapTypeId: 'roadmap',
    styles: getDarkMapStyle(),
    disableDefaultUI: false,
    zoomControl: true,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: true
  });

  marker = createPulseMarker(defaultCoords, map);

  refreshLocation();
}

function refreshLocation() {
  const locationText = document.getElementById('locationText');
  const coordText = document.getElementById('coordText');

  locationText && (locationText.textContent = 'Locating...');
  coordText && (coordText.textContent = '');

  if (!navigator.geolocation) {
    locationText && (locationText.textContent = 'Geolocation not supported');
    return;
  }

  navigator.geolocation.getCurrentPosition(
    pos => {
      currentLat = pos.coords.latitude;
      currentLng = pos.coords.longitude;
      const coords = { lat: currentLat, lng: currentLng };

      if (map && marker) {
        map.setCenter(coords);
        map.setZoom(15);
        marker.setPosition(coords);
      }

      coordText && (coordText.textContent = `${currentLat.toFixed(5)}, ${currentLng.toFixed(5)}`);
      reverseGeocode(currentLat, currentLng);
      saveLocationToFirestore(currentLat, currentLng);

      localStorage.setItem('lastKnownLocation', JSON.stringify(coords));
    },
    error => {
      console.error('Geolocation error:', error);

      const saved = localStorage.getItem('lastKnownLocation');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          currentLat = parsed.lat;
          currentLng = parsed.lng;
          const coords = { lat: currentLat, lng: currentLng };

          if (map && marker) {
            map.setCenter(coords);
            map.setZoom(15);
            marker.setPosition(coords);
          }

          locationText && (locationText.textContent = 'Using last known location');
          coordText && (coordText.textContent = `${currentLat.toFixed(5)}, ${currentLng.toFixed(5)}`);
          reverseGeocode(currentLat, currentLng);
          return;
        } catch {}
      }

      if (!locationText) return;
      if (error.code === 1) locationText.textContent = 'Location permission denied';
      else if (error.code === 2) locationText.textContent = 'Location unavailable';
      else if (error.code === 3) locationText.textContent = 'Location request timed out';
      else locationText.textContent = 'Could not fetch location';
    },
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 }
  );
}

function reverseGeocode(lat, lng) {
  const locationText = document.getElementById('locationText');
  if (!locationText) return;

  if (typeof google === 'undefined' || !google.maps) {
    locationText.textContent = `Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)}`;
    return;
  }

  const geocoder = new google.maps.Geocoder();
  geocoder.geocode({ location: { lat, lng } }, (results, status) => {
    if (status === 'OK' && results && results[0]) {
      locationText.textContent = results[0].formatted_address;
    } else {
      locationText.textContent = `Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)}`;
    }
  });
}

function showMapPlaceholder() {
  const mapDiv = document.getElementById('map');
  if (!mapDiv) return;
  mapDiv.innerHTML = `
    <div class="map-placeholder">
      <div class="pin-icon">📍</div>
      <p>Map unavailable</p>
    </div>
  `;
}

function saveLocationToFirestore(lat, lng) {
  if (!currentUser || !navigator.onLine) return;

  db.collection('users')
    .doc(currentUser.uid)
    .collection('meta')
    .doc('location')
    .set({
      lat,
      lng,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    })
    .catch(err => console.error('Location save error:', err));

  if (currentGroupCode) {
    const displayName = document.getElementById('profileName')?.value.trim() || currentUser.email || 'Family member';
    db.collection('groups').doc(currentGroupCode).collection('locations').doc(currentUser.uid).set({
      lat,
      lng,
      name: displayName,
      color: currentGroupColor || GROUP_COLORS[0],
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }).catch(err => console.error('Group location save error:', err));
  }
}

// ─── SOS helpers ──────────────────────────────
function buildAlertMessage() {
  const lat = currentLat || 12.9716;
  const lng = currentLng || 77.5946;
  const mapsLink = `https://maps.google.com/?q=${lat},${lng}`;
  const displayName =
    document.getElementById('profileName')?.value.trim() ||
    currentUser?.email ||
    'A LifeSaver user';

  return `🚨 EMERGENCY ALERT\n\n${displayName} needs help!\n📍 Location: ${mapsLink}\n\nPlease respond immediately.`;
}

function sortContactsByPriority() {
  const order = { primary: 1, secondary: 2, other: 3 };
  return [...contacts].sort((a, b) => (order[a.priority] || 3) - (order[b.priority] || 3));
}

function sendSmartWhatsApp(message) {
  const encoded = encodeURIComponent(message);
  const sendAll = document.getElementById('sendAllToggle')?.checked;

  const selected = sendAll ? sortContactsByPriority() : sortContactsByPriority().filter(c => c.priority === 'primary');

  if (!selected.length) {
    showToast('❌ No contact available for WhatsApp');
    return;
  }

  selected.forEach(contact => {
    let phone = (contact.phone || '').replace(/\D/g, '');
    if (phone) {
      window.open(`https://wa.me/${phone}?text=${encoded}`, '_blank');
    }
  });
}

function fallbackNativeSMS(message, phoneNumbers) {
  const encoded = encodeURIComponent(message);
  phoneNumbers.forEach(phone => {
    let p = phone.replace(/\D/g, '');
    if (p) {
      window.location.href = `sms:${p}?body=${encoded}`;
    }
  });
}

function callPrimaryContact() {
  const primary = sortContactsByPriority()[0];
  let phone = (primary?.phone || '').replace(/\D/g, '');

  if (!phone) return showToast('❌ No valid phone number');
  window.location.href = `tel:${phone}`;
}

function copyAlertMessage(message) {
  if (!navigator.clipboard) return;
  navigator.clipboard.writeText(message).catch(() => {});
}

function cacheEmergencyData() {
  localStorage.setItem('lifesaver_contacts_cache', JSON.stringify(contacts));
  localStorage.setItem('lifesaver_profile_cache', JSON.stringify({
    name: document.getElementById('profileName')?.value.trim() || '',
    phone: document.getElementById('profilePhone')?.value.trim() || '',
    medical: document.getElementById('profileMedical')?.value.trim() || ''
  }));
}

// ─── Feature 2: SOS countdown (cancel window) ─
// SVG ring drains via a pure CSS stroke-dashoffset transition (started/
// reset from here); the center number and the 5s completion are driven by
// a plain interval/timeout so they stay perfectly in sync with the ring.
const SOS_RING_CIRCUMFERENCE = 2 * Math.PI * 72;

function startSosCountdown(opts = {}) {
  if (countdownState) {
    cancelSosCountdown();
    return;
  }
  if (!currentUser) return showToast('⚠️ Please log in first');
  if (contacts.length === 0) return showToast('⚠️ Add at least one emergency contact first');

  const wrap = document.getElementById('panicWrap');
  const btn = document.getElementById('panicBtn');
  const ring = document.getElementById('sosRingProgress');
  const numberEl = document.getElementById('countdownNumber');

  if (!wrap || !btn) { triggerAlert(opts); return; }

  let remaining = 5;

  wrap.classList.add('counting');
  btn.classList.add('counting');
  if (numberEl) {
    numberEl.textContent = String(remaining);
    numberEl.classList.remove('hidden');
  }

  if (ring) {
    ring.style.strokeDasharray = String(SOS_RING_CIRCUMFERENCE);
    ring.style.transition = 'none';
    ring.style.strokeDashoffset = '0';
    void ring.getBoundingClientRect(); // force reflow so the transition below actually plays
    ring.style.transition = 'stroke-dashoffset 5s linear';
    ring.style.strokeDashoffset = String(SOS_RING_CIRCUMFERENCE);
  }

  const intervalId = setInterval(() => {
    remaining -= 1;
    if (remaining > 0 && numberEl) numberEl.textContent = String(remaining);
  }, 1000);

  const timeoutId = setTimeout(() => {
    const finishedOpts = countdownState ? countdownState.opts : opts;
    resetCountdownUI();
    countdownState = null;
    triggerAlert(finishedOpts);
  }, 5000);

  countdownState = { intervalId, timeoutId, opts };
}

function resetCountdownUI() {
  const wrap = document.getElementById('panicWrap');
  const btn = document.getElementById('panicBtn');
  const ring = document.getElementById('sosRingProgress');
  const numberEl = document.getElementById('countdownNumber');

  wrap && wrap.classList.remove('counting');
  btn && btn.classList.remove('counting');
  numberEl && numberEl.classList.add('hidden');

  if (ring) {
    ring.style.transition = 'none';
    ring.style.strokeDashoffset = '0';
  }
}

function cancelSosCountdown() {
  if (!countdownState) return;
  clearInterval(countdownState.intervalId);
  clearTimeout(countdownState.timeoutId);
  resetCountdownUI();
  countdownState = null;
  if (navigator.vibrate) navigator.vibrate(120);
  showToast('❌ SOS cancelled');
}

// ─── Trigger Alert (actual send) ──────────────
async function triggerAlert(opts = {}) {
  const source = opts.source || 'manual';

  if (!currentUser) return showToast('⚠️ Please log in first');
  if (contacts.length === 0) return showToast('⚠️ Add at least one emergency contact first');

  const statusDiv = document.getElementById('alertStatus');
  const msg = document.getElementById('alertMsg');
  const btn = document.getElementById('panicBtn');
  const lowNetworkMode = document.getElementById('lowNetworkToggle')?.checked || !navigator.onLine;

  if (btn) {
    btn.classList.add('activated');
    setTimeout(() => btn.classList.remove('activated'), 1600); // matches 4 × 0.4s alert-pulse
  }

  const siren = document.getElementById('sirenSound');
  if (siren) {
    siren.currentTime = 0;
    siren.play().catch(() => {});
    setTimeout(() => {
      siren.pause();
      siren.currentTime = 0;
    }, 4000);
  }

  statusDiv && statusDiv.classList.remove('hidden');
  msg && (msg.textContent = lowNetworkMode ? 'Low network mode active…' : 'Preparing emergency alert…');

  const audioRec = document.getElementById('audioRecording');
  if (audioRec) {
    audioRec.classList.remove('hidden');
    setTimeout(() => audioRec.classList.add('hidden'), 10000);
  }

  try {
    if (typeof refreshLocation === 'function') refreshLocation();

    const alertMessage = buildAlertMessage();
    cacheEmergencyData();
    copyAlertMessage(alertMessage);

    const contactRefs = contacts.map(c => c.phone || c.email || c.name);
    const lat = currentLat || 12.9716;
    const lng = currentLng || 77.5946;

    if (navigator.onLine) {
      await db.collection('users')
        .doc(currentUser.uid)
        .collection('alerts')
        .add({
          lat,
          lng,
          message: alertMessage,
          contacts: contactRefs,
          status: lowNetworkMode ? 'low-network' : 'prepared',
          source,
          timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
      // functions/index.js's onNewAlert trigger picks this up and sends
      // Twilio SMS + email + FCM push to family group members automatically.

      if (currentGroupCode) {
        const displayName = document.getElementById('profileName')?.value.trim() || currentUser.email || 'A family member';
        db.collection('groups').doc(currentGroupCode).collection('alerts').add({
          uid: currentUser.uid,
          name: displayName,
          lat,
          lng,
          message: alertMessage,
          source,
          timestamp: firebase.firestore.FieldValue.serverTimestamp()
        }).catch(err => console.error('Group alert broadcast error:', err));
      }

      alertsSent++;
      updateCounts();
      await loadHistory();
    } else {
      const idToken = await currentUser.getIdToken().catch(() => null);
      if (idToken && window.LifeSaverPWA) {
        await window.LifeSaverPWA.queueOfflineAlert(currentUser.uid, idToken, {
          lat, lng, message: alertMessage, contacts: contactRefs, source
        });
        showToast('📡 Offline — alert queued and will send automatically once reconnected');
      } else {
        const offlineAlerts = JSON.parse(localStorage.getItem('lifesaver_offline_alerts') || '[]');
        offlineAlerts.push({ message: alertMessage, timestamp: new Date().toISOString(), status: 'offline' });
        localStorage.setItem('lifesaver_offline_alerts', JSON.stringify(offlineAlerts));
      }
    }

    if (lowNetworkMode) {
      fallbackNativeSMS(alertMessage, contactRefs.filter(c => /\d{6,}/.test(c)));
      showToast('🚨 Low network mode: SMS fallback opened');
    } else {
      sendSmartWhatsApp(alertMessage);
      showToast('🚨 Alert sent — WhatsApp opened, SMS/email/push dispatching');
    }
  } catch (err) {
    console.error(err);
    showToast('❌ Alert failed');
  }

  if (statusDiv) {
    setTimeout(() => statusDiv.classList.add('hidden'), 5000);
  }
}

// ─── Feature 3: Push notifications (FCM) ──────
async function enablePushNotifications() {
  if (!currentUser) return showToast('⚠️ Please log in first');
  if (!messaging) return showToast('⚠️ Push notifications aren\'t supported in this browser');

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return showToast('⚠️ Notification permission denied');

    const swReg = window.LifeSaverPWA?.getFcmServiceWorkerRegistration?.();
    const token = await messaging.getToken({
      vapidKey: FCM_VAPID_KEY,
      serviceWorkerRegistration: swReg
    });

    if (!token) return showToast('❌ Could not retrieve a push token');

    await db.collection('users').doc(currentUser.uid).collection('tokens').doc(token).set({
      token,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      ua: navigator.userAgent
    });

    showToast('✅ Push notifications enabled');
  } catch (err) {
    console.error('enablePushNotifications error:', err);
    showToast('❌ Failed to enable push notifications (check FCM_VAPID_KEY in firebase-config.js)');
  }
}

// ─── Feature 6: Family Safety Group ───────────
function generateGroupCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function createFamilyGroup() {
  if (!currentUser) return showToast('⚠️ Please log in first');

  let code = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = generateGroupCode();
    const doc = await db.collection('groups').doc(candidate).get();
    if (!doc.exists) { code = candidate; break; }
  }
  if (!code) return showToast('❌ Could not generate a unique code — try again');

  const name = document.getElementById('profileName')?.value.trim() || currentUser.email || 'Member';
  const color = GROUP_COLORS[0];

  try {
    await db.collection('groups').doc(code).set({
      code,
      ownerUid: currentUser.uid,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      members: { [currentUser.uid]: { name, color, joinedAt: new Date().toISOString() } }
    });
    await db.collection('users').doc(currentUser.uid).collection('meta').doc('group').set({ code, color });

    currentGroupCode = code;
    currentGroupColor = color;
    subscribeToGroup(code);
    renderFamilyGroupUI();
    showToast(`✅ Family group created — share code ${code}`);
  } catch (err) {
    console.error('createFamilyGroup error:', err);
    showToast('❌ Failed to create family group');
  }
}

async function joinFamilyGroup() {
  if (!currentUser) return showToast('⚠️ Please log in first');
  const input = document.getElementById('joinGroupCode');
  const code = (input?.value || '').trim();

  if (!/^\d{6}$/.test(code)) return showToast('⚠️ Enter a valid 6-digit code');

  try {
    const ref = db.collection('groups').doc(code);
    const doc = await ref.get();
    if (!doc.exists) return showToast('❌ No family group found with that code');

    const members = doc.data().members || {};
    const usedColors = Object.values(members).map(m => m.color);
    const color = GROUP_COLORS.find(c => !usedColors.includes(c)) || GROUP_COLORS[Object.keys(members).length % GROUP_COLORS.length];
    const name = document.getElementById('profileName')?.value.trim() || currentUser.email || 'Member';

    await ref.update({ [`members.${currentUser.uid}`]: { name, color, joinedAt: new Date().toISOString() } });
    await db.collection('users').doc(currentUser.uid).collection('meta').doc('group').set({ code, color });

    currentGroupCode = code;
    currentGroupColor = color;
    input.value = '';
    subscribeToGroup(code);
    renderFamilyGroupUI();
    showToast('✅ Joined family group');
  } catch (err) {
    console.error('joinFamilyGroup error:', err);
    showToast('❌ Failed to join family group');
  }
}

async function leaveFamilyGroup() {
  if (!currentUser || !currentGroupCode) return;
  const code = currentGroupCode;

  try {
    await db.collection('groups').doc(code).update({
      [`members.${currentUser.uid}`]: firebase.firestore.FieldValue.delete()
    });
    await db.collection('groups').doc(code).collection('locations').doc(currentUser.uid).delete().catch(() => {});
    await db.collection('users').doc(currentUser.uid).collection('meta').doc('group').delete();

    unsubscribeFromGroup();
    currentGroupCode = null;
    currentGroupColor = null;
    clearFamilyMarkers();
    renderFamilyGroupUI();
    showToast('👋 Left family group');
  } catch (err) {
    console.error('leaveFamilyGroup error:', err);
    showToast('❌ Failed to leave family group');
  }
}

async function loadGroupMembership() {
  if (!currentUser) return;
  try {
    const doc = await db.collection('users').doc(currentUser.uid).collection('meta').doc('group').get();
    if (doc.exists) {
      currentGroupCode = doc.data().code;
      currentGroupColor = doc.data().color;
      subscribeToGroup(currentGroupCode);
    }
  } catch (err) {
    console.error('loadGroupMembership error:', err);
  }
}

function subscribeToGroup(code) {
  unsubscribeFromGroup();

  groupDocUnsub = db.collection('groups').doc(code).onSnapshot(doc => {
    renderFamilyGroupUI(doc.exists ? doc.data() : null);
  });

  groupLocationsUnsub = db.collection('groups').doc(code).collection('locations').onSnapshot(snapshot => {
    renderFamilyMarkers(snapshot);
  });

  groupAlertsUnsub = db.collection('groups').doc(code).collection('alerts')
    .orderBy('timestamp', 'desc')
    .limit(5)
    .onSnapshot(snapshot => {
      snapshot.docChanges().forEach(change => {
        if (change.type !== 'added') return;
        const data = change.doc.data();
        if (groupAlertsSeen.has(change.doc.id)) return;
        groupAlertsSeen.add(change.doc.id);
        if (data.uid === currentUser?.uid) return; // don't notify yourself
        showToast(`🚨 ${data.name || 'A family member'} triggered SOS!`);
      });
    });
}

function unsubscribeFromGroup() {
  groupDocUnsub && groupDocUnsub();
  groupLocationsUnsub && groupLocationsUnsub();
  groupAlertsUnsub && groupAlertsUnsub();
  groupDocUnsub = groupLocationsUnsub = groupAlertsUnsub = null;
  clearFamilyMarkers();
}

function clearFamilyMarkers() {
  Object.values(familyMarkers).forEach(m => m.setMap(null));
  familyMarkers = {};
}

function renderFamilyMarkers(snapshot) {
  if (typeof google === 'undefined' || !google.maps || !map) return;

  snapshot.docChanges().forEach(change => {
    const uid = change.doc.id;
    if (uid === currentUser?.uid) return; // your own marker already shown

    if (change.type === 'removed') {
      if (familyMarkers[uid]) { familyMarkers[uid].setMap(null); delete familyMarkers[uid]; }
      return;
    }

    const data = change.doc.data();
    if (!data.lat || !data.lng) return;
    const pos = { lat: data.lat, lng: data.lng };

    if (familyMarkers[uid]) {
      familyMarkers[uid].setPosition(pos);
    } else {
      familyMarkers[uid] = new google.maps.Marker({
        position: pos,
        map,
        title: data.name || 'Family member',
        label: { text: (data.name || 'F').charAt(0).toUpperCase(), color: '#0b0d11', fontWeight: '700' },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 9,
          fillColor: data.color || '#00e676',
          fillOpacity: 1,
          strokeColor: '#fff',
          strokeWeight: 2
        }
      });
    }
  });
}

function renderFamilyGroupUI(groupData) {
  const panel = document.getElementById('familyPanel');
  if (!panel) return;

  if (!currentUser) {
    panel.innerHTML = `<div class="empty-state"><div class="empty-icon">🔒</div><p>Please log in to manage your family group.</p></div>`;
    return;
  }

  if (!currentGroupCode) {
    panel.innerHTML = `
      <div class="family-setup-grid">
        <div class="family-card">
          <h3>Create a Family Group</h3>
          <p>Start a group and share the 6-digit code with your family.</p>
          <button type="button" class="btn-primary" onclick="createFamilyGroup()">+ Create Group</button>
        </div>
        <div class="family-card">
          <h3>Join a Family Group</h3>
          <p>Enter the 6-digit code shared with you.</p>
          <input type="text" id="joinGroupCode" maxlength="6" placeholder="123456" inputmode="numeric" />
          <button type="button" class="btn-primary" onclick="joinFamilyGroup()">Join Group</button>
        </div>
      </div>
    `;
    return;
  }

  db.collection('groups').doc(currentGroupCode).get().then(doc => {
    const data = groupData || (doc.exists ? doc.data() : { members: {} });
    const members = data.members || {};
    const memberHtml = Object.entries(members).map(([uid, m]) => `
      <div class="family-member-row">
        <span class="family-color-dot" style="background:${m.color}"></span>
        <span class="family-member-name">${escapeHtml(m.name || 'Member')}</span>
        ${uid === currentUser.uid ? '<span class="family-you-badge">You</span>' : ''}
      </div>
    `).join('');

    panel.innerHTML = `
      <div class="family-card">
        <h3>Your Family Group</h3>
        <p class="family-code-display">Share this code: <strong>${currentGroupCode}</strong></p>
        <div class="family-members-list">${memberHtml || '<p>No members yet.</p>'}</div>
        <button type="button" class="btn-ghost" onclick="leaveFamilyGroup()">Leave Group</button>
      </div>
    `;
  });
}

// ─── Contacts ─────────────────────────────────
async function loadContacts() {
  if (!currentUser) {
    contacts = [];
    renderContacts();
    return;
  }

  try {
    const snapshot = await db.collection('users')
      .doc(currentUser.uid)
      .collection('contacts')
      .orderBy('createdAt', 'desc')
      .get();

    contacts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    localStorage.setItem('lifesaver_contacts_cache', JSON.stringify(contacts));
    renderContacts();
  } catch (err) {
    console.error('Load contacts error:', err);
    contacts = JSON.parse(localStorage.getItem('lifesaver_contacts_cache') || '[]');
    renderContacts();
  }
}

function renderContacts() {
  const list = document.getElementById('contactsList');
  const contactCount = document.getElementById('contactCount');

  if (contactCount) contactCount.textContent = contacts.length;
  if (!list) return;

  if (!currentUser) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔒</div>
        <p>Please log in to manage contacts.</p>
      </div>
    `;
    return;
  }

  if (contacts.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📭</div>
        <p>No emergency contacts added yet.</p>
      </div>
    `;
    return;
  }

  list.innerHTML = contacts.map(contact => `
    <div class="contact-card">
      <div class="contact-top">
        <div class="contact-avatar">${escapeHtml((contact.name || 'U').charAt(0).toUpperCase())}</div>
        <div>
          <div class="contact-name">${escapeHtml(contact.name || 'Unnamed')}</div>
          <span class="contact-relation">${escapeHtml(contact.relation || '-')}</span>
          <span class="contact-relation priority-badge ${contact.priority || 'other'}">${escapeHtml(contact.priority || 'other')}</span>
        </div>
      </div>
      <div class="contact-detail"><span>📞</span>${escapeHtml(contact.phone || '-')}</div>
      ${contact.email ? `<div class="contact-detail"><span>✉️</span>${escapeHtml(contact.email)}</div>` : ''}
      <div class="contact-actions">
        <button type="button" class="btn-sm danger" onclick="deleteContact('${contact.id}')">Delete</button>
      </div>
    </div>
  `).join('');
}

async function addContact() {
  if (!currentUser) return showToast('⚠️ Please log in first');

  const name = document.getElementById('cName')?.value.trim() || '';
  const phone = document.getElementById('cPhone')?.value.trim() || '';
  const email = document.getElementById('cEmail')?.value.trim() || '';
  const relation = document.getElementById('cRelation')?.value || 'Family';
  const priority = document.getElementById('cPriority')?.value || 'other';

  if (!name || (!phone && !email)) return showToast('⚠️ Enter name and phone or email');

  try {
    await db.collection('users')
      .doc(currentUser.uid)
      .collection('contacts')
      .add({
        name,
        phone,
        email,
        relation,
        priority,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });

    document.getElementById('cName').value = '';
    document.getElementById('cPhone').value = '';
    document.getElementById('cEmail').value = '';
    document.getElementById('cRelation').selectedIndex = 0;
    document.getElementById('cPriority').value = 'other';

    closeModal();
    showToast('✅ Contact added');
    await loadContacts();
  } catch (err) {
    console.error('Add contact error:', err);
    showToast('❌ Failed to add contact');
  }
}

async function deleteContact(contactId) {
  if (!currentUser) return;

  try {
    await db.collection('users')
      .doc(currentUser.uid)
      .collection('contacts')
      .doc(contactId)
      .delete();

    showToast('🗑️ Contact deleted');
    await loadContacts();
  } catch (err) {
    console.error('Delete contact error:', err);
    showToast('❌ Failed to delete contact');
  }
}

// ─── History ──────────────────────────────────
async function loadHistory() {
  const historyList = document.getElementById('historyList');
  const alertCount = document.getElementById('alertCount');
  if (!historyList) return;

  if (!currentUser) {
    historyList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔒</div>
        <p>Please log in to view your alert history.</p>
      </div>
    `;
    alertCount && (alertCount.textContent = '0');
    return;
  }

  try {
    const snapshot = await db.collection('users')
      .doc(currentUser.uid)
      .collection('alerts')
      .orderBy('timestamp', 'desc')
      .get();

    alertsSent = snapshot.size;
    updateCounts();

    if (snapshot.empty) {
      historyList.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📜</div>
          <p>No alerts sent yet.</p>
        </div>
      `;
      return;
    }

    const sourceLabels = {
      manual: '👆 Manual',
      'fall-detection': '🤸 Fall Detected',
      'shake-detection': '📳 Shake Trigger',
      'ai-checkin': '🤖 AI Check-in'
    };

    historyList.innerHTML = snapshot.docs.map(doc => {
      const data = doc.data();
      const timeText = data.timestamp?.toDate ? data.timestamp.toDate().toLocaleString() : 'Just now';
      const sourceLabel = sourceLabels[data.source] || '';

      return `
        <div class="history-card">
          <div class="history-header">
            <span class="status ${data.status || 'prepared'}">${escapeHtml(data.status || 'prepared')}</span>
            ${sourceLabel ? `<span class="history-source">${sourceLabel}</span>` : ''}
            <span class="time">${escapeHtml(timeText)}</span>
          </div>
          <div class="history-message">
            <pre>${escapeHtml(data.message || '')}</pre>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Load history error:', err);
    historyList.innerHTML = `<p>❌ Failed to load history.</p>`;
  }
}

// ─── Profile ──────────────────────────────────
async function loadProfile() {
  if (!currentUser) return;

  try {
    const doc = await db.collection('users')
      .doc(currentUser.uid)
      .collection('meta')
      .doc('profile')
      .get();

    const nameInput = document.getElementById('profileName');
    const phoneInput = document.getElementById('profilePhone');
    const medicalInput = document.getElementById('profileMedical');
    const userName = document.getElementById('userName');
    const avatarInitial = document.getElementById('avatarInitial');

    if (doc.exists) {
      const data = doc.data();

      nameInput && (nameInput.value = data.name || '');
      phoneInput && (phoneInput.value = data.phone || '');
      medicalInput && (medicalInput.value = data.medical || '');

      localStorage.setItem('lifesaver_profile_cache', JSON.stringify(data));

      const displayName = data.name || currentUser.email || 'Buddy';
      userName && (userName.textContent = displayName);
      avatarInitial && (avatarInitial.textContent = displayName.charAt(0).toUpperCase());
    } else {
      const cached = JSON.parse(localStorage.getItem('lifesaver_profile_cache') || '{}');
      if (cached.name) {
        nameInput && (nameInput.value = cached.name || '');
        phoneInput && (phoneInput.value = cached.phone || '');
        medicalInput && (medicalInput.value = cached.medical || '');
        userName && (userName.textContent = cached.name);
        avatarInitial && (avatarInitial.textContent = cached.name.charAt(0).toUpperCase());
      }
    }
  } catch (err) {
    console.error('Load profile error:', err);
  }
}

async function saveProfile() {
  try {
    const user = firebase.auth().currentUser;
    if (!user) return showToast('⚠️ Please log in first');

    const name = document.getElementById('profileName')?.value.trim() || '';
    const phone = document.getElementById('profilePhone')?.value.trim() || '';
    const medical = document.getElementById('profileMedical')?.value.trim() || '';

    const payload = {
      name,
      phone,
      medical,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    localStorage.setItem('lifesaver_profile_cache', JSON.stringify({ name, phone, medical }));

    if (navigator.onLine) {
      await db.collection('users')
        .doc(user.uid)
        .collection('meta')
        .doc('profile')
        .set(payload);
    }

    const displayName = name || user.email || 'Buddy';
    document.getElementById('userName').textContent = displayName;
    document.getElementById('avatarInitial').textContent = displayName.charAt(0).toUpperCase();

    showToast('✅ Profile saved');
  } catch (err) {
    console.error('Save profile error:', err);
    showToast('❌ Failed to save profile');
  }
}

// ─── Modal ────────────────────────────────────
function openModal() {
  if (!currentUser) return showToast('⚠️ Please log in first');
  document.getElementById('modal')?.classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modal')?.classList.add('hidden');
}

// ─── Utilities ────────────────────────────────
function updateCounts() {
  document.getElementById('contactCount').textContent = contacts.length;
  document.getElementById('alertCount').textContent = alertsSent;
  updateNetworkStatus();
}

function showToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;

  toast.textContent = message;
  toast.classList.remove('hidden');
  toast.classList.add('show');

  setTimeout(() => {
    toast.classList.remove('show');
    toast.classList.add('hidden');
  }, 2500);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, m => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[m]));
}

// Dark "tactical" map theme — ink/wire palette with a cyan water accent.
function getDarkMapStyle() {
  return [
    { elementType: 'geometry', stylers: [{ color: '#0b0d11' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#0b0d11' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#4a5278' }] },
    { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#2a3045' }] },
    { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#8891b4' }] },
    { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#13161d' }] },
    { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#4a5278' }] },
    { featureType: 'poi.business', stylers: [{ visibility: 'off' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1a1e28' }] },
    { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#2a3045' }] },
    { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#232838' }] },
    { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#3a4460' }] },
    { featureType: 'transit', stylers: [{ visibility: 'off' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0d1b24' }] },
    { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#00d4ff' }] }
  ];
}

// ─── Signature element: rotating radar sweep behind the SOS button ──
function initRadarSweep() {
  const canvas = document.getElementById('radarCanvas');
  if (!canvas || !canvas.getContext) return;

  const ctx = canvas.getContext('2d');
  const size = 260;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  ctx.scale(dpr, dpr);

  const cx = size / 2;
  const cy = size / 2;
  const maxR = size / 2 - 4;
  const sweepWidth = Math.PI / 3.2;
  let angle = 0;
  let rafId = null;

  function draw() {
    ctx.clearRect(0, 0, size, size);

    ctx.strokeStyle = 'rgba(232,25,44,0.18)';
    ctx.lineWidth = 1;
    [0.35, 0.6, 0.85, 1].forEach(f => {
      ctx.beginPath();
      ctx.arc(cx, cy, maxR * f, 0, Math.PI * 2);
      ctx.stroke();
    });

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, maxR, angle - sweepWidth, angle);
    ctx.closePath();

    if (typeof ctx.createConicGradient === 'function') {
      const grad = ctx.createConicGradient(angle - sweepWidth, cx, cy);
      grad.addColorStop(0, 'rgba(232,25,44,0)');
      grad.addColorStop(1, 'rgba(232,25,44,0.35)');
      ctx.fillStyle = grad;
    } else {
      ctx.fillStyle = 'rgba(232,25,44,0.2)';
    }
    ctx.fill();
    ctx.restore();

    const dotX = cx + Math.cos(angle) * maxR;
    const dotY = cy + Math.sin(angle) * maxR;
    ctx.beginPath();
    ctx.fillStyle = '#e8192c';
    ctx.shadowColor = '#e8192c';
    ctx.shadowBlur = 8;
    ctx.arc(dotX, dotY, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    angle += 0.018;
    if (angle > Math.PI * 2) angle -= Math.PI * 2;

    rafId = document.hidden ? null : requestAnimationFrame(draw);
  }

  draw();

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !rafId) draw();
  });
}

// ─── Init ─────────────────────────────────────
(function init() {
  renderContacts();
  updateNetworkStatus();
  initRadarSweep();

  const saved = localStorage.getItem('lastKnownLocation');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      currentLat = parsed.lat;
      currentLng = parsed.lng;
      const coordText = document.getElementById('coordText');
      if (coordText) coordText.textContent = `${currentLat.toFixed(5)}, ${currentLng.toFixed(5)}`;
    } catch {}
  }

  setTimeout(() => {
    if (typeof refreshLocation === 'function') refreshLocation();
  }, 1000);
})();

// ─── Globals ──────────────────────────────────
window.signup = signup;
window.login = login;
window.logout = logout;
window.initMap = initMap;
window.refreshLocation = refreshLocation;
window.triggerAlert = triggerAlert;
window.startSosCountdown = startSosCountdown;
window.openModal = openModal;
window.closeModal = closeModal;
window.addContact = addContact;
window.saveProfile = saveProfile;
window.deleteContact = deleteContact;
window.callPrimaryContact = callPrimaryContact;
window.scheduleFakeCall = scheduleFakeCall;
window.enablePushNotifications = enablePushNotifications;
window.createFamilyGroup = createFamilyGroup;
window.joinFamilyGroup = joinFamilyGroup;
window.leaveFamilyGroup = leaveFamilyGroup;
window.loadHistory = loadHistory;
window.showToast = showToast;

function scheduleFakeCall() {
  showToast('📱 Fake call scheduled in 10 seconds. Keep your volume up.');
  setTimeout(() => {
    if (navigator.vibrate) {
      navigator.vibrate([1000, 500, 1000, 500, 1000]);
    }
    const siren = document.getElementById('sirenSound');
    if (siren) {
      siren.currentTime = 0;
      siren.play().catch(() => {});
      setTimeout(() => siren.pause(), 5000);
    }

    const fakeCallUI = document.createElement('div');
    fakeCallUI.style.position = 'fixed';
    fakeCallUI.style.inset = '0';
    fakeCallUI.style.background = '#1a1a1a';
    fakeCallUI.style.zIndex = '9999';
    fakeCallUI.style.display = 'flex';
    fakeCallUI.style.flexDirection = 'column';
    fakeCallUI.style.alignItems = 'center';
    fakeCallUI.style.justifyContent = 'center';
    fakeCallUI.innerHTML = `
      <div style="font-size: 2rem; color: #fff; margin-bottom: 10px;">Dad</div>
      <div style="font-size: 1.2rem; color: #aaa; margin-bottom: 50px;">Incoming Call...</div>
      <div style="display: flex; gap: 40px;">
        <button id="declineCall" style="width: 70px; height: 70px; border-radius: 50%; background: #e8192c; border: none; font-size: 1.5rem; cursor: pointer;">📞</button>
        <button id="acceptCall" style="width: 70px; height: 70px; border-radius: 50%; background: #00e676; border: none; font-size: 1.5rem; cursor: pointer;">📞</button>
      </div>
    `;
    document.body.appendChild(fakeCallUI);

    document.getElementById('declineCall').onclick = () => {
      document.body.removeChild(fakeCallUI);
      if (siren) siren.pause();
    };

    document.getElementById('acceptCall').onclick = () => {
      document.body.removeChild(fakeCallUI);
      if (siren) siren.pause();
      showToast('Fake call answered.');
    };
  }, 10000);
}
