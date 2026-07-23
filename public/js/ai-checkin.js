/* ═══════════════════════════════════════════════
   LifeSaver Cloud – ai-checkin.js
   Feature 8: AI-powered daily safety check-in.
   Classification happens server-side (functions/index.js
   calls the Claude API) — this file only prompts the
   user, calls the callable function, and renders status.
═══════════════════════════════════════════════ */

(function () {
  const PROMPT_DATE_KEY = 'lifesaver_last_checkin_prompt_date';
  const CHECK_INTERVAL_MS = 60 * 60 * 1000; // re-check hourly whether today's prompt has fired

  let currentUser = null;
  let intervalHandle = null;

  function todayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  function onLogin(user) {
    currentUser = user;
    loadLastCheckin();
    maybePromptDaily();
    if (!intervalHandle) {
      intervalHandle = setInterval(maybePromptDaily, CHECK_INTERVAL_MS);
    }
  }

  function onLogout() {
    currentUser = null;
    if (intervalHandle) {
      clearInterval(intervalHandle);
      intervalHandle = null;
    }
    renderWidget(null);
  }

  function maybePromptDaily() {
    if (!currentUser) return;
    const lastPrompted = localStorage.getItem(PROMPT_DATE_KEY);
    if (lastPrompted === todayKey()) return;
    localStorage.setItem(PROMPT_DATE_KEY, todayKey());
    openCheckinModal();
  }

  async function loadLastCheckin() {
    if (!currentUser || typeof firebase === 'undefined') return;
    try {
      const doc = await firebase.firestore()
        .collection('users').doc(currentUser.uid)
        .collection('meta').doc('lastCheckin').get();
      renderWidget(doc.exists ? doc.data() : null);
    } catch (err) {
      console.error('Load check-in error:', err);
    }
  }

  function renderWidget(data) {
    const statusEl = document.getElementById('checkinStatusBadge');
    const timeEl = document.getElementById('checkinTime');
    if (!statusEl || !timeEl) return;

    if (!data) {
      statusEl.textContent = 'No check-ins yet';
      statusEl.className = 'checkin-badge neutral';
      timeEl.textContent = '';
      return;
    }

    const sentiment = data.status || 'SAFE';
    statusEl.textContent = sentiment;
    statusEl.className = `checkin-badge ${sentiment.toLowerCase()}`;

    const ts = data.timestamp && data.timestamp.toDate ? data.timestamp.toDate() : new Date();
    timeEl.textContent = `Last check-in: ${ts.toLocaleString()}`;
  }

  function openCheckinModal() {
    if (!currentUser) return;
    if (document.getElementById('checkinModal')) return;

    const overlay = document.createElement('div');
    overlay.id = 'checkinModal';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-head">
          <h3>🤖 Daily Safety Check-in</h3>
          <button type="button" class="modal-close" id="checkinCloseBtn">✕</button>
        </div>
        <p class="checkin-prompt-text">How are you doing today?</p>
        <div class="checkin-quick-actions">
          <button type="button" class="btn-primary" data-msg="I'm fine, all good.">🙂 I'm fine</button>
          <button type="button" class="btn-warning" data-msg="I'm not feeling great today.">😕 Not great</button>
        </div>
        <div class="form-group">
          <label for="checkinMessage">Or describe how you're feeling</label>
          <textarea id="checkinMessage" placeholder="Type a short message…"></textarea>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn-ghost" id="checkinCloseBtn2">Skip</button>
          <button type="button" class="btn-primary" id="checkinSubmitBtn">Send Check-in</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector('#checkinCloseBtn').addEventListener('click', close);
    overlay.querySelector('#checkinCloseBtn2').addEventListener('click', close);

    overlay.querySelectorAll('[data-msg]').forEach((btn) => {
      btn.addEventListener('click', () => submitCheckin(btn.dataset.msg, overlay));
    });

    overlay.querySelector('#checkinSubmitBtn').addEventListener('click', () => {
      const text = overlay.querySelector('#checkinMessage').value.trim();
      if (!text) {
        if (typeof window.showToast === 'function') window.showToast('⚠️ Enter a message first');
        return;
      }
      submitCheckin(text, overlay);
    });
  }

  async function submitCheckin(message, overlay) {
    if (!currentUser || typeof firebase === 'undefined') return;

    const submitBtn = overlay.querySelector('#checkinSubmitBtn');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Sending…'; }

    try {
      const classify = firebase.functions().httpsCallable('classifyCheckin');
      const result = await classify({ message });
      const sentiment = result.data && result.data.sentiment ? result.data.sentiment : 'SAFE';

      overlay.remove();
      await loadLastCheckin();

      if (sentiment === 'DISTRESS') {
        if (typeof window.showToast === 'function') {
          window.showToast('🚨 Distress detected — your emergency contacts are being alerted');
        }
        if (typeof window.loadHistory === 'function') window.loadHistory();
      } else if (sentiment === 'CONCERNED') {
        if (typeof window.showToast === 'function') window.showToast('💛 Check-in received — take care of yourself');
      } else {
        if (typeof window.showToast === 'function') window.showToast('✅ Check-in received — glad you\'re safe');
      }
    } catch (err) {
      console.error('Check-in classify error:', err);
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Send Check-in'; }
      if (typeof window.showToast === 'function') window.showToast('❌ Could not process check-in. Try again.');
    }
  }

  window.LifeSaverCheckin = {
    onLogin,
    onLogout,
    openCheckinModal
  };
})();
