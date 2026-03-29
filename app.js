/* ═══════════════════════════════════════════════
   LifeSaver Cloud – app.js
   Full corrected version
═══════════════════════════════════════════════ */

// NOTE:
// Do NOT redeclare `db` here if firebase-config.js already has:
// const db = firebase.firestore();

// ─── State ────────────────────────────────────
let currentLat = null;
let currentLng = null;
let map = null;
let marker = null;
let contacts = [];
let alertsSent = 0;
let currentUser = null;

// ─── Navigation ───────────────────────────────
document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', e => {
    e.preventDefault();
    const page = link.dataset.page;
    navigateTo(page);
  });
});

function navigateTo(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));

  const page = document.getElementById(pageId);
  const nav = document.querySelector(`[data-page="${pageId}"]`);

  if (page) page.classList.add('active');
  if (nav) nav.classList.add('active');

  if (pageId === 'contacts') renderContacts();
  if (pageId === 'history') loadHistory();
  if (pageId === 'profile') loadProfile();
}

// ─── Auth ─────────────────────────────────────
firebase.auth().onAuthStateChanged(async user => {
  const authStatus = document.getElementById('authStatus');
  const authForm = document.getElementById('authForm');
  const loggedInBar = document.getElementById('loggedInBar');
  const loggedInText = document.getElementById('loggedInText');

  if (user) {
    currentUser = user;

    if (authStatus) authStatus.textContent = `Logged in as ${user.email}`;
    if (authForm) authForm.classList.add('hidden');
    if (loggedInBar) loggedInBar.classList.remove('hidden');
    if (loggedInText) loggedInText.textContent = `Welcome, ${user.email}`;

    await loadContacts();
    await loadProfile();
    await loadHistory();

    showToast('✅ Logged in');
  } else {
    currentUser = null;
    contacts = [];
    alertsSent = 0;

    if (authStatus) authStatus.textContent = 'Not logged in';
    if (authForm) authForm.classList.remove('hidden');
    if (loggedInBar) loggedInBar.classList.add('hidden');

    const contactCount = document.getElementById('contactCount');
    const alertCount = document.getElementById('alertCount');
    const historyList = document.getElementById('historyList');
    const userName = document.getElementById('userName');
    const avatarInitial = document.getElementById('avatarInitial');

    if (contactCount) contactCount.textContent = '0';
    if (alertCount) alertCount.textContent = '0';
    if (userName) userName.textContent = 'Buddy';
    if (avatarInitial) avatarInitial.textContent = 'B';

    renderContacts();

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
  const email = document.getElementById('email')?.value.trim();
  const password = document.getElementById('password')?.value.trim();

  if (!email || !password) {
    showToast('⚠️ Enter email and password');
    return;
  }

  firebase.auth()
    .createUserWithEmailAndPassword(email, password)
    .then(() => showToast('✅ Signed up successfully'))
    .catch(err => {
      console.error('Signup error:', err);
      showToast(`❌ ${err.message}`);
    });
}

function login() {
  const email = document.getElementById('email')?.value.trim();
  const password = document.getElementById('password')?.value.trim();

  if (!email || !password) {
    showToast('⚠️ Enter email and password');
    return;
  }

  firebase.auth()
    .signInWithEmailAndPassword(email, password)
    .then(() => showToast('✅ Logged in successfully'))
    .catch(err => {
      console.error('Login error:', err);
      showToast(`❌ ${err.message}`);
    });
}

function logout() {
  firebase.auth()
    .signOut()
    .then(() => showToast('✅ Logged out'))
    .catch(err => {
      console.error('Logout error:', err);
      showToast(`❌ ${err.message}`);
    });
}

// ─── Google Maps ──────────────────────────────
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

  marker = new google.maps.Marker({
    position: defaultCoords,
    map: map,
    title: 'Your Location',
    icon: {
      path: google.maps.SymbolPath.CIRCLE,
      scale: 10,
      fillColor: '#e8192c',
      fillOpacity: 1,
      strokeColor: '#fff',
      strokeWeight: 2
    },
    animation: google.maps.Animation.DROP
  });

  google.maps.event.trigger(map, 'resize');
  map.setCenter(marker.getPosition());

  refreshLocation();
}

function refreshLocation() {
  const locationText = document.getElementById('locationText');
  const coordText = document.getElementById('coordText');

  if (locationText) locationText.textContent = 'Locating...';
  if (coordText) coordText.textContent = '';

  if (!navigator.geolocation) {
    if (locationText) locationText.textContent = 'Geolocation not supported';
    return;
  }

  navigator.geolocation.getCurrentPosition(
    position => {
      currentLat = position.coords.latitude;
      currentLng = position.coords.longitude;

      const coords = { lat: currentLat, lng: currentLng };

      if (map && marker) {
        map.setCenter(coords);
        map.setZoom(15);
        marker.setPosition(coords);
      }

      if (coordText) {
        coordText.textContent = `${currentLat.toFixed(5)}, ${currentLng.toFixed(5)}`;
      }

      reverseGeocode(currentLat, currentLng);
      saveLocationToFirestore(currentLat, currentLng);

      localStorage.setItem(
        'lastKnownLocation',
        JSON.stringify({
          lat: currentLat,
          lng: currentLng
        })
      );
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

          if (locationText) locationText.textContent = 'Using last known location';
          if (coordText) {
            coordText.textContent = `${currentLat.toFixed(5)}, ${currentLng.toFixed(5)}`;
          }

          reverseGeocode(currentLat, currentLng);
          return;
        } catch (e) {
          console.error('Saved location parse error:', e);
        }
      }

      if (!locationText) return;

      if (error.code === 1) {
        locationText.textContent = 'Location permission denied';
      } else if (error.code === 2) {
        locationText.textContent = 'Location unavailable';
      } else if (error.code === 3) {
        locationText.textContent = 'Location request timed out';
      } else {
        locationText.textContent = 'Could not fetch location';
      }
    },
    {
      enableHighAccuracy: true,
      timeout: 20000,
      maximumAge: 60000
    }
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
    <div class="map-placeholder" style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;min-height:250px;text-align:center;padding:20px;">
      <div style="font-size:2rem;">📍</div>
      <p>Add your Google Maps API key to see live map</p>
    </div>
  `;
}

function saveLocationToFirestore(lat, lng) {
  if (!currentUser) return;

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
}

// ─── SOS / Alert ──────────────────────────────
function openAlertOptions(message) {
  const encoded = encodeURIComponent(message);
  openWhatsAppShare(encoded, message);
}

function openWhatsAppShare(encodedMessage, rawMessage) {
  let phone = contacts[0]?.phone || '';

  phone = phone.replace(/\D/g, '');

  if (!phone) {
    showToast('❌ No valid contact number');
    return;
  }

  const whatsappUrl = `https://wa.me/${phone}?text=${encodedMessage}`;
  window.open(whatsappUrl, '_blank');

  copyAlertMessage(rawMessage);
}

function copyAlertMessage(message) {
  if (!navigator.clipboard) return;

  navigator.clipboard.writeText(message)
    .then(() => showToast('✅ Alert message copied'))
    .catch(err => console.log('Clipboard copy failed:', err));
}

async function triggerAlert() {
  if (!currentUser) {
    showToast('⚠️ Please log in first');
    return;
  }

  if (contacts.length === 0) {
    showToast('⚠️ Add at least one emergency contact first');
    return;
  }

  const statusDiv = document.getElementById('alertStatus');
  const msg = document.getElementById('alertMsg');
  const btn = document.getElementById('panicBtn');

  if (btn) {
    btn.classList.add('activated');
    setTimeout(() => btn.classList.remove('activated'), 2000);
  }

  const siren = document.getElementById('sirenSound');
  if (siren) {
    siren.currentTime = 0;
    siren.play().catch(err => console.log('Siren error:', err));

    setTimeout(() => {
      siren.pause();
      siren.currentTime = 0;
    }, 4000);
  }

  if (statusDiv) statusDiv.classList.remove('hidden');
  if (msg) msg.textContent = 'Preparing emergency message…';

  try {
    if (typeof refreshLocation === 'function') {
      refreshLocation();
    }

    const lat = currentLat || 12.9716;
    const lng = currentLng || 77.5946;
    const mapsLink = `https://maps.google.com/?q=${lat},${lng}`;

    const displayName =
      document.getElementById('profileName')?.value.trim() ||
      currentUser.email ||
      'A LifeSaver user';

    const alertMessage =
      `🚨 EMERGENCY ALERT\n\n` +
      `${displayName} may need help.\n` +
      `📍 Location: ${mapsLink}\n\n` +
      `Please contact them immediately.`;

    const alertData = {
      lat: lat,
      lng: lng,
      contacts: contacts.map(c => c.phone || c.email || c.name),
      message: alertMessage,
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
      status: 'prepared'
    };

    await db.collection('users')
      .doc(currentUser.uid)
      .collection('alerts')
      .add(alertData);

    alertsSent++;
    const alertCount = document.getElementById('alertCount');
    if (alertCount) alertCount.textContent = alertsSent;

    if (msg) msg.textContent = 'Opening WhatsApp…';

    openAlertOptions(alertMessage);
    showToast('🚨 Emergency message prepared');
    loadHistory();
  } catch (err) {
    console.error('Trigger alert error:', err);
    showToast('❌ Failed to prepare alert');
  }

  if (statusDiv) {
    setTimeout(() => statusDiv.classList.add('hidden'), 5000);
  }
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

    contacts = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    const contactCount = document.getElementById('contactCount');
    if (contactCount) contactCount.textContent = contacts.length;

    renderContacts();
  } catch (err) {
    console.error('Load contacts error:', err);
    showToast('❌ Failed to load contacts');
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
      <h3>${escapeHtml(contact.name || 'Unnamed')}</h3>
      <p><strong>Phone:</strong> ${escapeHtml(contact.phone || '-')}</p>
      <p><strong>Email:</strong> ${escapeHtml(contact.email || '-')}</p>
      <p><strong>Relation:</strong> ${escapeHtml(contact.relation || '-')}</p>
      <button type="button" class="btn-ghost" onclick="deleteContact('${contact.id}')">Delete</button>
    </div>
  `).join('');
}

async function addContact() {
  if (!currentUser) {
    showToast('⚠️ Please log in first');
    return;
  }

  const name = document.getElementById('cName')?.value.trim();
  const phone = document.getElementById('cPhone')?.value.trim();
  const email = document.getElementById('cEmail')?.value.trim();
  const relation = document.getElementById('cRelation')?.value;

  if (!name || (!phone && !email)) {
    showToast('⚠️ Enter name and phone or email');
    return;
  }

  try {
    await db.collection('users')
      .doc(currentUser.uid)
      .collection('contacts')
      .add({
        name,
        phone,
        email,
        relation,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });

    document.getElementById('cName').value = '';
    document.getElementById('cPhone').value = '';
    document.getElementById('cEmail').value = '';
    document.getElementById('cRelation').selectedIndex = 0;

    closeModal();
    showToast('✅ Contact added');
    loadContacts();
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
    loadContacts();
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
    if (alertCount) alertCount.textContent = '0';
    return;
  }

  try {
    const snapshot = await db.collection('users')
      .doc(currentUser.uid)
      .collection('alerts')
      .orderBy('timestamp', 'desc')
      .get();

    alertsSent = snapshot.size;
    if (alertCount) alertCount.textContent = alertsSent;

    if (snapshot.empty) {
      historyList.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📜</div>
          <p>No alerts sent yet.</p>
        </div>
      `;
      return;
    }

    historyList.innerHTML = snapshot.docs.map(doc => {
      const data = doc.data();
      let timeText = 'Just now';

      if (data.timestamp && data.timestamp.toDate) {
        timeText = data.timestamp.toDate().toLocaleString();
      }

      return `
        <div class="history-card">
          <div class="history-header">
            <span class="status ${data.status || 'prepared'}">
              ${data.status === 'sent' ? '🚨 Sent' : '📝 Prepared'}
            </span>
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

      if (nameInput) nameInput.value = data.name || '';
      if (phoneInput) phoneInput.value = data.phone || '';
      if (medicalInput) medicalInput.value = data.medical || '';

      const displayName = data.name || 'Buddy';
      if (userName) userName.textContent = displayName;
      if (avatarInitial) avatarInitial.textContent = displayName.charAt(0).toUpperCase();
    } else {
      if (userName) userName.textContent = 'Buddy';
      if (avatarInitial) avatarInitial.textContent = 'B';
    }
  } catch (err) {
    console.error('Load profile error:', err);
    showToast('❌ Failed to load profile');
  }
}

async function saveProfile() {
  try {
    const user = firebase.auth().currentUser;
    if (!user) {
      showToast('⚠️ Please log in first');
      return;
    }

    const name = document.getElementById('profileName')?.value.trim() || '';
    const phone = document.getElementById('profilePhone')?.value.trim() || '';
    const medical = document.getElementById('profileMedical')?.value.trim() || '';

    await db.collection('users')
      .doc(user.uid)
      .collection('meta')
      .doc('profile')
      .set({
        name,
        phone,
        medical,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });

    const userName = document.getElementById('userName');
    const avatarInitial = document.getElementById('avatarInitial');

    const displayName = name || user.email || 'Buddy';
    if (userName) userName.textContent = displayName;
    if (avatarInitial) avatarInitial.textContent = displayName.charAt(0).toUpperCase();

    showToast('✅ Profile saved');
  } catch (err) {
    console.error('Save profile error:', err);
    showToast('❌ Failed to save profile');
  }
}

// ─── Modal ────────────────────────────────────
function openModal() {
  if (!currentUser) {
    showToast('⚠️ Please log in first');
    return;
  }

  const modal = document.getElementById('modal');
  if (modal) modal.classList.remove('hidden');
}

function closeModal() {
  const modal = document.getElementById('modal');
  if (modal) modal.classList.add('hidden');
}

// ─── Utilities ────────────────────────────────
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

function getDarkMapStyle() {
  return [
    { elementType: 'geometry', stylers: [{ color: '#1d2c4d' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#8ec3b9' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#1a3646' }] },
    { featureType: 'administrative.country', elementType: 'geometry.stroke', stylers: [{ color: '#4b6878' }] },
    { featureType: 'administrative.land_parcel', elementType: 'labels.text.fill', stylers: [{ color: '#64779e' }] },
    { featureType: 'administrative.province', elementType: 'geometry.stroke', stylers: [{ color: '#4b6878' }] },
    { featureType: 'landscape.man_made', elementType: 'geometry.stroke', stylers: [{ color: '#334e87' }] },
    { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#023e58' }] },
    { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#283d6a' }] },
    { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#6f9ba5' }] },
    { featureType: 'poi', elementType: 'labels.text.stroke', stylers: [{ color: '#1d2c4d' }] },
    { featureType: 'poi.park', elementType: 'geometry.fill', stylers: [{ color: '#023e58' }] },
    { featureType: 'poi.park', elementType: 'labels.text.fill', stylers: [{ color: '#3C7680' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#304a7d' }] },
    { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#98a5be' }] },
    { featureType: 'road', elementType: 'labels.text.stroke', stylers: [{ color: '#1d2c4d' }] },
    { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#2c6675' }] },
    { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#255763' }] },
    { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#b0d5ce' }] },
    { featureType: 'road.highway', elementType: 'labels.text.stroke', stylers: [{ color: '#023e58' }] },
    { featureType: 'transit', elementType: 'labels.text.fill', stylers: [{ color: '#98a5be' }] },
    { featureType: 'transit', elementType: 'labels.text.stroke', stylers: [{ color: '#1d2c4d' }] },
    { featureType: 'transit.line', elementType: 'geometry.fill', stylers: [{ color: '#283d6a' }] },
    { featureType: 'transit.station', elementType: 'geometry', stylers: [{ color: '#3a4762' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0e1626' }] },
    { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#4e6d70' }] }
  ];
}

// ─── Init ─────────────────────────────────────
(function init() {
  renderContacts();

  const saved = localStorage.getItem('lastKnownLocation');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      currentLat = parsed.lat;
      currentLng = parsed.lng;

      const coordText = document.getElementById('coordText');
      if (coordText && currentLat !== null && currentLng !== null) {
        coordText.textContent = `${currentLat.toFixed(5)}, ${currentLng.toFixed(5)}`;
      }
    } catch (e) {
      console.log('No saved location');
    }
  }

  setTimeout(() => {
    if (typeof refreshLocation === 'function') refreshLocation();
  }, 1000);
})();

// ─── Make functions global for inline HTML onclick ───────────
window.signup = signup;
window.login = login;
window.logout = logout;
window.initMap = initMap;
window.refreshLocation = refreshLocation;
window.triggerAlert = triggerAlert;
window.openModal = openModal;
window.closeModal = closeModal;
window.addContact = addContact;
window.saveProfile = saveProfile;
window.deleteContact = deleteContact;