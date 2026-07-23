/* ═══════════════════════════════════════════════
   LifeSaver Cloud – motion-detection.js
   Feature 4: Fall detection via DeviceMotion
   Feature 5: Shake-to-SOS via DeviceMotion
═══════════════════════════════════════════════ */

(function () {
  const SETTINGS_KEY = 'lifesaver_shake_settings';

  // Fall-detection thresholds (m/s²), per spec: spike > 25 followed within
  // 1.5s by near-stillness < 3.
  const FALL_SPIKE_THRESHOLD = 25;
  const FALL_STILL_THRESHOLD = 3;
  const FALL_STILL_WINDOW_MS = 1500;
  const FALL_MIN_GAP_MS = 200; // ignore the same instant as the spike itself

  // Shake-detection: 3 shakes within 2s, sensitivity controls the per-shake
  // acceleration-delta threshold.
  const SHAKE_WINDOW_MS = 2000;
  const SHAKE_COUNT_REQUIRED = 3;
  const SHAKE_DEBOUNCE_MS = 150;
  const SHAKE_THRESHOLDS = { low: 22, medium: 15, high: 10 };

  const CHART_MAX_POINTS = 40;
  const CHART_UPDATE_INTERVAL_MS = 150;

  let listening = false;
  let spikeTimestamp = null;
  let lastMagnitude = null;
  let lastShakeAt = 0;
  let shakeTimestamps = [];
  let lastChartUpdate = 0;
  let chart = null;

  let settings = loadSettings();

  function loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      return {
        shakeEnabled: saved.shakeEnabled !== false,
        sensitivity: saved.sensitivity || 'medium'
      };
    } catch {
      return { shakeEnabled: true, sensitivity: 'medium' };
    }
  }

  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    updateShakeWaveIndicator();
  }

  function isSupported() {
    return typeof window !== 'undefined' && 'DeviceMotionEvent' in window;
  }

  // ─── Permission (iOS 13+ requires a user gesture) ─────────
  async function requestPermission() {
    if (!isSupported()) {
      if (typeof window.showToast === 'function') {
        window.showToast('⚠️ Motion sensors not supported on this device/browser');
      }
      return false;
    }

    if (typeof DeviceMotionEvent.requestPermission === 'function') {
      try {
        const result = await DeviceMotionEvent.requestPermission();
        if (result !== 'granted') {
          if (typeof window.showToast === 'function') {
            window.showToast('⚠️ Motion permission denied');
          }
          return false;
        }
      } catch (err) {
        console.error('DeviceMotion permission error:', err);
        return false;
      }
    }

    startListening();
    if (typeof window.showToast === 'function') {
      window.showToast('✅ Fall & shake detection active');
    }
    const btn = document.getElementById('enableMotionBtn');
    if (btn) btn.classList.add('hidden');
    return true;
  }

  function startListening() {
    if (listening || !isSupported()) return;
    window.addEventListener('devicemotion', handleMotion);
    listening = true;
    initMotionChart();
  }

  function stopListening() {
    window.removeEventListener('devicemotion', handleMotion);
    listening = false;
  }

  // ─── Core motion handler ───────────────────────
  function handleMotion(event) {
    const g = event.accelerationIncludingGravity;
    if (!g || g.x === null || g.x === undefined) return;

    const x = g.x, y = g.y, z = g.z;
    const magnitude = Math.sqrt(x * x + y * y + z * z);

    updateChart(x, y, z);
    checkShake(magnitude);
    checkFall(magnitude);
  }

  // ─── Feature 4: Fall detection ─────────────────
  function checkFall(magnitude) {
    const delta = Math.abs(magnitude - 9.8);
    const now = Date.now();

    if (delta > FALL_SPIKE_THRESHOLD) {
      spikeTimestamp = now;
      return;
    }

    if (spikeTimestamp) {
      const elapsed = now - spikeTimestamp;
      if (elapsed > FALL_STILL_WINDOW_MS) {
        spikeTimestamp = null;
      } else if (elapsed > FALL_MIN_GAP_MS && delta < FALL_STILL_THRESHOLD) {
        spikeTimestamp = null;
        triggerFallDetected();
      }
    }
  }

  function triggerFallDetected() {
    if (document.getElementById('fallModal')) return; // already showing
    if (navigator.vibrate) navigator.vibrate([400, 100, 400]);
    showFallModal();
  }

  function showFallModal() {
    const overlay = document.createElement('div');
    overlay.id = 'fallModal';
    overlay.className = 'modal-overlay fall-overlay';
    overlay.innerHTML = `
      <div class="modal fall-modal">
        <div class="fall-icon">🚨</div>
        <h2>Are you okay?</h2>
        <p>We detected a possible fall. SOS will be sent automatically in</p>
        <div class="fall-countdown" id="fallCountdownNum">10</div>
        <button type="button" class="btn-fall-cancel" id="fallCancelBtn">I'M OK — CANCEL</button>
      </div>
    `;
    document.body.appendChild(overlay);

    let remaining = 10;
    const numEl = overlay.querySelector('#fallCountdownNum');
    const interval = setInterval(() => {
      remaining -= 1;
      numEl.textContent = remaining;
      if (remaining <= 0) {
        clearInterval(interval);
        overlay.remove();
        if (typeof window.triggerAlert === 'function') {
          window.triggerAlert({ source: 'fall-detection' });
        }
      }
    }, 1000);

    overlay.querySelector('#fallCancelBtn').addEventListener('click', () => {
      clearInterval(interval);
      if (navigator.vibrate) navigator.vibrate(80);
      overlay.remove();
      if (typeof window.showToast === 'function') window.showToast('👍 Glad you\'re okay');
    });
  }

  // ─── Feature 5: Shake-to-SOS ────────────────────
  function checkShake(magnitude) {
    if (!settings.shakeEnabled) { lastMagnitude = magnitude; return; }
    if (lastMagnitude === null) { lastMagnitude = magnitude; return; }

    const delta = Math.abs(magnitude - lastMagnitude);
    lastMagnitude = magnitude;

    const threshold = SHAKE_THRESHOLDS[settings.sensitivity] || SHAKE_THRESHOLDS.medium;
    if (delta <= threshold) return;

    const now = Date.now();
    if (now - lastShakeAt < SHAKE_DEBOUNCE_MS) return;
    lastShakeAt = now;

    shakeTimestamps.push(now);
    shakeTimestamps = shakeTimestamps.filter((t) => now - t <= SHAKE_WINDOW_MS);

    if (shakeTimestamps.length >= SHAKE_COUNT_REQUIRED) {
      shakeTimestamps = [];
      triggerShakeDetected();
    }
  }

  function triggerShakeDetected() {
    if (navigator.vibrate) navigator.vibrate([150, 60, 150, 60, 150]);
    if (typeof window.startSosCountdown === 'function') {
      window.startSosCountdown({ source: 'shake-detection' });
    }
  }

  function setShakeEnabled(enabled) {
    settings.shakeEnabled = enabled;
    saveSettings();
  }

  function setSensitivity(level) {
    if (!SHAKE_THRESHOLDS[level]) return;
    settings.sensitivity = level;
    saveSettings();
  }

  function updateShakeWaveIndicator() {
    const el = document.getElementById('shakeWaveIndicator');
    if (!el) return;
    el.classList.toggle('hidden', !settings.shakeEnabled);
  }

  function initSettingsUI() {
    const toggle = document.getElementById('shakeToggle');
    const slider = document.getElementById('shakeSensitivity');
    const label = document.getElementById('shakeSensitivityLabel');

    if (toggle) {
      toggle.checked = settings.shakeEnabled;
      toggle.addEventListener('change', () => setShakeEnabled(toggle.checked));
    }

    if (slider) {
      const levels = ['low', 'medium', 'high'];
      slider.value = levels.indexOf(settings.sensitivity) >= 0 ? levels.indexOf(settings.sensitivity) : 1;
      const updateLabel = () => {
        const lvl = levels[slider.value];
        if (label) label.textContent = lvl.charAt(0).toUpperCase() + lvl.slice(1);
      };
      updateLabel();
      slider.addEventListener('input', () => {
        updateLabel();
        setSensitivity(levels[slider.value]);
      });
    }

    updateShakeWaveIndicator();
  }

  // ─── Chart.js live accelerometer graph ─────────
  function initMotionChart() {
    if (chart || typeof window.Chart === 'undefined') return;
    const canvas = document.getElementById('motionChart');
    if (!canvas) return;

    chart = new window.Chart(canvas, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          { label: 'X', borderColor: '#e8192c', data: [], pointRadius: 0, borderWidth: 1.5, tension: 0.3 },
          { label: 'Y', borderColor: '#0dff8c', data: [], pointRadius: 0, borderWidth: 1.5, tension: 0.3 },
          { label: 'Z', borderColor: '#2a82ff', data: [], pointRadius: 0, borderWidth: 1.5, tension: 0.3 }
        ]
      },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { display: false },
          y: { ticks: { color: '#8891a4', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.05)' } }
        },
        plugins: {
          legend: { labels: { color: '#8891a4', boxWidth: 10, font: { size: 10 } } }
        }
      }
    });
  }

  function updateChart(x, y, z) {
    if (!chart) return;
    const now = Date.now();
    if (now - lastChartUpdate < CHART_UPDATE_INTERVAL_MS) return;
    lastChartUpdate = now;

    chart.data.labels.push('');
    chart.data.datasets[0].data.push(x.toFixed(2));
    chart.data.datasets[1].data.push(y.toFixed(2));
    chart.data.datasets[2].data.push(z.toFixed(2));

    if (chart.data.labels.length > CHART_MAX_POINTS) {
      chart.data.labels.shift();
      chart.data.datasets.forEach((ds) => ds.data.shift());
    }

    chart.update('none');
  }

  function init() {
    initSettingsUI();
    updateShakeWaveIndicator();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.LifeSaverMotion = {
    isSupported,
    requestPermission,
    stopListening,
    setShakeEnabled,
    setSensitivity
  };
})();
