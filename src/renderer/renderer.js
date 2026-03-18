/**
 * ValueStream Recorder — Renderer Process
 * Manages UI state, IPC communication, and user interactions.
 */

// ============================================================
// State
// ============================================================
const state = {
  activeTab: 'record',
  recordingMode: 'screen',     // 'screen' | 'manual'
  recordingStatus: 'idle',     // 'idle' | 'recording' | 'stopped'
  recordingStartTime: null,
  steps: [],
  recording: null,             // completed recording data
  connected: false,
  maps: [],
  settings: {
    api_url: 'https://mapvs.com/api/v1',
    preferences: {
      screenshot_interval: 5000,
      screenshot_quality: 'medium',
      auto_capture_on_window_change: true,
      storage_path: ''
    }
  },
  timerInterval: null,
  uniqueWindows: new Set()
};

// ============================================================
// Initialization
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  setupTabNavigation();
  setupModeToggle();
  setupIntervalSelector();
  setupRecordingControls();
  setupSyncControls();
  setupSettingsControls();
  setupKeyboardShortcuts();
  await loadSettings();
  await checkConnection();
});

// ============================================================
// Tab Navigation
// ============================================================
function setupTabNavigation() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      switchTab(btn.dataset.tab);
    });
  });

  // Settings gear button goes to settings tab
  document.getElementById('settingsBtn').addEventListener('click', () => {
    switchTab('settings');
  });
}

function switchTab(tabId) {
  state.activeTab = tabId;

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });

  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === `tab-${tabId}`);
  });

  // Refresh data when switching tabs
  if (tabId === 'review') refreshReviewTab();
  if (tabId === 'sync') refreshSyncTab();
}

// ============================================================
// Mode Toggle
// ============================================================
function setupModeToggle() {
  document.querySelectorAll('.mode-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (state.recordingStatus === 'recording') return; // can't switch during recording
      setRecordingMode(btn.dataset.mode);
    });
  });
}

function setRecordingMode(mode) {
  state.recordingMode = mode;

  document.querySelectorAll('.mode-toggle-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  document.getElementById('screen-idle').classList.toggle('hidden', mode !== 'screen');
  document.getElementById('manual-idle').classList.toggle('hidden', mode !== 'manual');
}

// ============================================================
// Interval Selector
// ============================================================
function setupIntervalSelector() {
  document.querySelectorAll('.interval-option').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.interval-option').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.settings.preferences.screenshot_interval = parseInt(btn.dataset.interval);
    });
  });
}

// ============================================================
// Recording Controls
// ============================================================
function setupRecordingControls() {
  document.getElementById('startScreenRecording').addEventListener('click', () => startRecording('screen'));
  document.getElementById('startManualRecording').addEventListener('click', () => startRecording('manual'));
  document.getElementById('stopRecording').addEventListener('click', stopRecording);
  document.getElementById('captureStepBtn').addEventListener('click', captureManualStep);

  // Enter key in notes input triggers capture
  document.getElementById('stepNotesInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') captureManualStep();
  });
}

async function startRecording(mode) {
  try {
    // Save interval setting before starting
    await window.api.settings.set({
      preferences: { screenshot_interval: state.settings.preferences.screenshot_interval }
    });

    const result = await window.api.recording.start(mode);
    if (result.success) {
      state.recordingStatus = 'recording';
      state.recordingMode = mode;
      state.recordingStartTime = Date.now();
      state.steps = [];
      state.uniqueWindows.clear();
      updateRecordingUI();
      startTimer();
    }
  } catch (err) {
    console.error('Failed to start recording:', err);
  }
}

async function stopRecording() {
  try {
    const result = await window.api.recording.stop();
    if (result.success) {
      state.recordingStatus = 'stopped';
      state.recording = result.data;
      state.steps = result.data.steps || [];
      stopTimer();
      updateRecordingUI();
      // Switch to review tab
      switchTab('review');
    }
  } catch (err) {
    console.error('Failed to stop recording:', err);
  }
}

async function captureManualStep() {
  const notesInput = document.getElementById('stepNotesInput');
  const notes = notesInput.value.trim();

  try {
    const result = await window.api.recording.addStep(notes);
    if (result.success) {
      state.steps.push(result.data);
      if (result.data.window_title) {
        state.uniqueWindows.add(result.data.window_title);
      }
      notesInput.value = '';
      updateStepCounts();
      updateLatestScreenshot(result.data);
      updateRecentSteps();
    }
  } catch (err) {
    console.error('Failed to capture step:', err);
  }
}

function updateRecordingUI() {
  const isRecording = state.recordingStatus === 'recording';
  const isIdle = state.recordingStatus === 'idle' || state.recordingStatus === 'stopped';

  // Show/hide panels
  document.getElementById('screen-idle').classList.toggle('hidden', !isIdle || state.recordingMode !== 'screen');
  document.getElementById('manual-idle').classList.toggle('hidden', !isIdle || state.recordingMode !== 'manual');
  document.getElementById('recording-active').classList.toggle('hidden', !isRecording);
  document.getElementById('shortcutHints').classList.toggle('hidden', isRecording);

  if (isRecording) {
    document.getElementById('recordingModeLabel').textContent =
      state.recordingMode === 'screen' ? 'Screen Recording' : 'Manual Steps';
    document.getElementById('manualCaptureArea').classList.toggle('hidden', state.recordingMode !== 'manual');
  }

  // Disable mode toggle during recording
  document.querySelectorAll('.mode-toggle-btn').forEach(btn => {
    btn.style.pointerEvents = isRecording ? 'none' : 'auto';
    btn.style.opacity = isRecording ? '0.5' : '1';
  });
}

function updateStepCounts() {
  document.getElementById('stepCount').textContent = state.steps.length;
  document.getElementById('windowCount').textContent = state.uniqueWindows.size;
}

function updateLatestScreenshot(step) {
  if (step.screenshot_path) {
    const container = document.getElementById('latestScreenshot');
    const img = document.getElementById('latestScreenshotImg');
    img.src = `file://${step.screenshot_path}`;
    container.classList.remove('hidden');
  }
}

function updateRecentSteps() {
  const container = document.getElementById('recentSteps');
  const list = document.getElementById('recentStepList');

  if (state.steps.length === 0) {
    container.classList.add('hidden');
    return;
  }

  container.classList.remove('hidden');
  const recentSteps = state.steps.slice(-3).reverse();

  list.innerHTML = recentSteps.map(step => `
    <div class="step-card" style="cursor:default">
      ${step.screenshot_path ?
        `<img class="step-thumbnail" src="file://${step.screenshot_path}" alt="Step ${step.order}" />` :
        '<div class="step-thumbnail"></div>'
      }
      <div class="step-info">
        <div class="step-header">
          <span class="step-number">Step ${step.order}</span>
          <span class="step-time">${formatTimestamp(step.timestamp)}</span>
        </div>
        <div class="step-title">${escapeHtml(step.stage_name || step.window_title)}</div>
        <div class="step-app">${escapeHtml(step.app_name)}</div>
        ${step.notes ? `<div class="text-sm text-muted" style="margin-top:2px">${escapeHtml(step.notes)}</div>` : ''}
      </div>
    </div>
  `).join('');
}

// ============================================================
// Timer
// ============================================================
function startTimer() {
  updateTimerDisplay();
  state.timerInterval = setInterval(updateTimerDisplay, 1000);
}

function stopTimer() {
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }
}

function updateTimerDisplay() {
  if (!state.recordingStartTime) return;
  const elapsed = Math.floor((Date.now() - state.recordingStartTime) / 1000);
  const hrs = String(Math.floor(elapsed / 3600)).padStart(2, '0');
  const mins = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
  const secs = String(elapsed % 60).padStart(2, '0');
  document.getElementById('recordingTimer').textContent = `${hrs}:${mins}:${secs}`;
}

// ============================================================
// Review Tab
// ============================================================
function refreshReviewTab() {
  const hasRecording = state.recording && state.steps.length > 0;

  document.getElementById('reviewEmpty').classList.toggle('hidden', hasRecording);
  document.getElementById('reviewContent').classList.toggle('hidden', !hasRecording);

  if (!hasRecording) return;

  document.getElementById('reviewSummary').textContent =
    `${state.steps.length} steps captured — ${formatDuration(state.recording.startTime, state.recording.endTime)} total`;

  renderReviewSteps();
}

function renderReviewSteps() {
  const list = document.getElementById('reviewStepList');

  list.innerHTML = state.steps.map((step, index) => `
    <div class="step-card" draggable="true" data-index="${index}">
      ${step.screenshot_path ?
        `<img class="step-thumbnail" src="file://${step.screenshot_path}" alt="Step ${step.order}" />` :
        '<div class="step-thumbnail"></div>'
      }
      <div class="step-info">
        <div class="step-header">
          <span class="step-number">Step ${index + 1}</span>
          <span class="step-time">${step.duration_secs ? step.duration_secs.toFixed(1) + 's' : '--'}</span>
        </div>
        <input class="step-name-input" value="${escapeAttr(step.stage_name || '')}"
          data-index="${index}" data-field="stage_name"
          placeholder="Stage name..." />
        <div class="step-app">${escapeHtml(step.app_name)} — ${escapeHtml(step.window_title)}</div>
        <input class="editable-field" value="${escapeAttr(step.notes || '')}"
          data-index="${index}" data-field="notes"
          placeholder="Add notes..." style="margin-top:4px" />
        <div class="time-input-group">
          <div>
            <label>Cycle (s)</label><br>
            <input type="number" value="${step.cycle_time || 0}" min="0" step="0.1"
              data-index="${index}" data-field="cycle_time" />
          </div>
          <div>
            <label>Wait (s)</label><br>
            <input type="number" value="${step.wait_time || 0}" min="0" step="0.1"
              data-index="${index}" data-field="wait_time" />
          </div>
        </div>
      </div>
      <div class="step-actions">
        <button class="va-badge ${step.va_type || 'undetermined'}" data-index="${index}" data-action="toggle-va"
          title="Click to toggle VA/NVA">
          ${step.va_type === 'va' ? 'VA' : step.va_type === 'nva' ? 'NVA' : '?'}
        </button>
        <button class="icon-btn btn-sm" data-index="${index}" data-action="delete" title="Delete step"
          style="color:var(--vs-red);width:28px;height:28px">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    </div>
  `).join('');

  // Event delegation for review actions
  list.addEventListener('input', handleReviewInput);
  list.addEventListener('click', handleReviewClick);
  setupDragAndDrop(list);
}

function handleReviewInput(e) {
  const index = parseInt(e.target.dataset.index);
  const field = e.target.dataset.field;
  if (isNaN(index) || !field) return;

  if (field === 'cycle_time' || field === 'wait_time') {
    state.steps[index][field] = parseFloat(e.target.value) || 0;
  } else {
    state.steps[index][field] = e.target.value;
  }

  // Keep the recording data in sync
  if (state.recording) {
    state.recording.steps = state.steps;
  }
}

function handleReviewClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;

  const index = parseInt(btn.dataset.index);
  const action = btn.dataset.action;

  if (action === 'toggle-va') {
    const cycle = ['undetermined', 'va', 'nva'];
    const current = state.steps[index].va_type || 'undetermined';
    const next = cycle[(cycle.indexOf(current) + 1) % cycle.length];
    state.steps[index].va_type = next;
    if (state.recording) state.recording.steps = state.steps;
    renderReviewSteps();
  }

  if (action === 'delete') {
    state.steps.splice(index, 1);
    // Re-number steps
    state.steps.forEach((s, i) => s.order = i + 1);
    if (state.recording) state.recording.steps = state.steps;
    renderReviewSteps();
    document.getElementById('reviewSummary').textContent =
      `${state.steps.length} steps captured`;
  }
}

function setupDragAndDrop(container) {
  let draggedIndex = null;

  container.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.step-card');
    if (!card) return;
    draggedIndex = parseInt(card.dataset.index);
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  container.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  });

  container.addEventListener('drop', (e) => {
    e.preventDefault();
    const card = e.target.closest('.step-card');
    if (!card || draggedIndex === null) return;

    const dropIndex = parseInt(card.dataset.index);
    if (draggedIndex === dropIndex) return;

    // Reorder
    const [moved] = state.steps.splice(draggedIndex, 1);
    state.steps.splice(dropIndex, 0, moved);
    state.steps.forEach((s, i) => s.order = i + 1);
    if (state.recording) state.recording.steps = state.steps;
    renderReviewSteps();
  });

  container.addEventListener('dragend', () => {
    draggedIndex = null;
    container.querySelectorAll('.step-card').forEach(c => c.classList.remove('dragging'));
  });
}

document.getElementById('reviewClearBtn')?.addEventListener('click', () => {
  if (confirm('Clear this recording? This cannot be undone.')) {
    state.recording = null;
    state.steps = [];
    refreshReviewTab();
  }
});

// ============================================================
// Sync Tab
// ============================================================
function setupSyncControls() {
  document.getElementById('connectTokenBtn').addEventListener('click', async () => {
    const token = document.getElementById('tokenInput').value.trim();
    if (!token) return;
    await window.api.auth.setToken(token);
    await checkConnection();
  });

  document.getElementById('oauthLoginBtn').addEventListener('click', async () => {
    await window.api.auth.login();
  });

  document.getElementById('disconnectBtn')?.addEventListener('click', async () => {
    await window.api.auth.logout();
    state.connected = false;
    updateConnectionUI();
  });

  document.getElementById('mapSelector').addEventListener('change', (e) => {
    const value = e.target.value;
    document.getElementById('newMapNameGroup').style.display = value === '_new' ? 'block' : 'none';
    updateUploadButton();
  });

  document.getElementById('uploadBtn').addEventListener('click', uploadRecording);

  // Listen for OAuth token received from main process
  window.api.auth.onTokenReceived(async (token) => {
    await checkConnection();
  });
}

async function checkConnection() {
  try {
    const result = await window.api.sync.testConnection();
    state.connected = result.success && result.connected;
  } catch {
    state.connected = false;
  }
  updateConnectionUI();
}

function updateConnectionUI() {
  const dot = document.getElementById('connectionDot');
  const label = document.getElementById('connectionLabel');

  dot.className = `connection-dot ${state.connected ? 'connected' : 'disconnected'}`;
  label.textContent = state.connected ? 'Connected' : 'Disconnected';

  document.getElementById('syncDisconnected').classList.toggle('hidden', state.connected);
  document.getElementById('syncConnected').classList.toggle('hidden', !state.connected);

  if (state.connected) {
    loadMaps();
  }
}

async function loadMaps() {
  try {
    const result = await window.api.sync.getMaps();
    if (result.success) {
      state.maps = result.data;
      const selector = document.getElementById('mapSelector');
      selector.innerHTML = `
        <option value="">Select a map...</option>
        ${state.maps.map(m => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('')}
        <option value="_new">+ Create New Map</option>
      `;
    }
  } catch (err) {
    console.error('Failed to load maps:', err);
  }
}

function refreshSyncTab() {
  const hasRecording = state.recording && state.steps.length > 0;
  document.getElementById('uploadRecordingInfo').textContent = hasRecording
    ? `${state.steps.length} steps ready to upload`
    : 'No recording available to upload. Record a process first.';
  updateUploadButton();
}

function updateUploadButton() {
  const hasRecording = state.recording && state.steps.length > 0;
  const mapId = document.getElementById('mapSelector').value;
  const isNewMap = mapId === '_new';
  const newName = document.getElementById('newMapNameInput').value.trim();

  const canUpload = hasRecording && (mapId && mapId !== '' && (!isNewMap || newName));
  document.getElementById('uploadBtn').disabled = !canUpload;
}

async function uploadRecording() {
  const mapId = document.getElementById('mapSelector').value;
  const isNewMap = mapId === '_new';

  document.getElementById('uploadProgress').classList.remove('hidden');
  document.getElementById('uploadSuccess').classList.add('hidden');
  document.getElementById('uploadBtn').disabled = true;

  // Simulate progress
  let progress = 0;
  const progressInterval = setInterval(() => {
    progress = Math.min(progress + Math.random() * 15, 90);
    document.getElementById('uploadProgressBar').style.width = `${progress}%`;
    document.getElementById('uploadProgressPct').textContent = `${Math.round(progress)}%`;
  }, 300);

  try {
    let result;
    if (isNewMap) {
      const name = document.getElementById('newMapNameInput').value.trim();
      result = await window.api.sync.createMap({ name, recording: state.recording });
    } else {
      result = await window.api.sync.upload({ mapId, recording: state.recording });
    }

    clearInterval(progressInterval);

    if (result.success) {
      document.getElementById('uploadProgressBar').style.width = '100%';
      document.getElementById('uploadProgressPct').textContent = '100%';
      document.getElementById('uploadProgressLabel').textContent = 'Complete';

      const mapResultId = result.data?.map_id || mapId;
      const apiUrl = state.settings.api_url.replace('/api/v1', '');
      document.getElementById('viewMapLink').href = `${apiUrl}/maps/${mapResultId}`;

      setTimeout(() => {
        document.getElementById('uploadProgress').classList.add('hidden');
        document.getElementById('uploadSuccess').classList.remove('hidden');
      }, 500);
    } else {
      throw new Error(result.error || 'Upload failed');
    }
  } catch (err) {
    clearInterval(progressInterval);
    document.getElementById('uploadProgressLabel').textContent = `Error: ${err.message}`;
    document.getElementById('uploadProgressBar').style.width = '0%';
    document.getElementById('uploadBtn').disabled = false;
  }
}

// ============================================================
// Settings
// ============================================================
function setupSettingsControls() {
  document.getElementById('settingsAutoCapture').addEventListener('click', function() {
    this.classList.toggle('active');
  });

  document.getElementById('saveSettingsBtn').addEventListener('click', saveSettings);
  document.getElementById('clearDataBtn').addEventListener('click', clearData);
}

async function loadSettings() {
  try {
    const result = await window.api.settings.get();
    if (result) {
      state.settings = result;
      applySettingsToUI(result);
    }
  } catch (err) {
    console.error('Failed to load settings:', err);
  }
}

function applySettingsToUI(settings) {
  document.getElementById('settingsApiUrl').value = settings.api_url || 'https://mapvs.com/api/v1';

  if (settings.preferences) {
    document.getElementById('settingsInterval').value = settings.preferences.screenshot_interval || 5000;
    document.getElementById('settingsQuality').value = settings.preferences.screenshot_quality || 'medium';

    const autoCapBtn = document.getElementById('settingsAutoCapture');
    autoCapBtn.classList.toggle('active', settings.preferences.auto_capture_on_window_change !== false);

    if (settings.preferences.storage_path) {
      document.getElementById('storagePath').textContent = settings.preferences.storage_path;
    }

    // Sync interval selector on record tab
    state.settings.preferences.screenshot_interval = settings.preferences.screenshot_interval || 5000;
    document.querySelectorAll('.interval-option').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.interval) === state.settings.preferences.screenshot_interval);
    });
  }
}

async function saveSettings() {
  const settings = {
    api_url: document.getElementById('settingsApiUrl').value.trim(),
    preferences: {
      screenshot_interval: parseInt(document.getElementById('settingsInterval').value),
      screenshot_quality: document.getElementById('settingsQuality').value,
      auto_capture_on_window_change: document.getElementById('settingsAutoCapture').classList.contains('active')
    }
  };

  try {
    await window.api.settings.set(settings);
    state.settings = { ...state.settings, ...settings };

    // Flash button to confirm
    const btn = document.getElementById('saveSettingsBtn');
    btn.textContent = 'Saved';
    btn.style.background = '#22c55e';
    setTimeout(() => {
      btn.textContent = 'Save Settings';
      btn.style.background = '';
    }, 1500);
  } catch (err) {
    console.error('Failed to save settings:', err);
  }
}

async function clearData() {
  if (!confirm('This will delete all local recordings and screenshots. Continue?')) return;

  try {
    await window.api.settings.clearData();
    state.recording = null;
    state.steps = [];
    refreshReviewTab();

    const btn = document.getElementById('clearDataBtn');
    btn.textContent = 'Cleared';
    setTimeout(() => {
      btn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        </svg>
        Clear All Local Data
      `;
    }, 1500);
  } catch (err) {
    console.error('Failed to clear data:', err);
  }
}

// ============================================================
// Keyboard Shortcuts (from main process)
// ============================================================
function setupKeyboardShortcuts() {
  window.api.recording.onNewStep(async () => {
    if (state.recordingStatus === 'recording') {
      await captureManualStep();
    }
  });

  window.api.recording.onStopShortcut(async () => {
    if (state.recordingStatus === 'recording') {
      await stopRecording();
    }
  });

  window.api.recording.onStatusChanged((status) => {
    if (status === 'recording') {
      state.recordingStatus = 'recording';
    } else {
      state.recordingStatus = 'idle';
    }
    updateRecordingUI();
  });
}

// ============================================================
// Polling for screen recording step updates
// ============================================================
let pollInterval = null;

function startStepPolling() {
  pollInterval = setInterval(async () => {
    if (state.recordingStatus !== 'recording' || state.recordingMode !== 'screen') {
      if (pollInterval) clearInterval(pollInterval);
      return;
    }
    try {
      const status = await window.api.recording.getStatus();
      if (status.steps && status.steps.length > state.steps.length) {
        state.steps = status.steps;
        status.steps.forEach(s => {
          if (s.window_title) state.uniqueWindows.add(s.window_title);
        });
        updateStepCounts();
        const latest = status.steps[status.steps.length - 1];
        updateLatestScreenshot(latest);
        updateRecentSteps();
      }
    } catch (err) {
      // Ignore polling errors
    }
  }, 2000);
}

// Patch startRecording to include polling
const _origStartRecording = startRecording;
// Override is already handled in the flow

// Start polling when recording starts in screen mode
const origStart = document.getElementById('startScreenRecording');
if (origStart) {
  const origHandler = origStart.onclick;
  origStart.addEventListener('click', () => {
    setTimeout(() => {
      if (state.recordingStatus === 'recording' && state.recordingMode === 'screen') {
        startStepPolling();
      }
    }, 500);
  });
}

// ============================================================
// Utility Functions
// ============================================================
function formatTimestamp(isoString) {
  if (!isoString) return '--:--';
  const d = new Date(isoString);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDuration(startIso, endIso) {
  if (!startIso || !endIso) return '--';
  const ms = new Date(endIso) - new Date(startIso);
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remainSecs = secs % 60;
  if (mins < 60) return `${mins}m ${remainSecs}s`;
  const hrs = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hrs}h ${remainMins}m`;
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  if (!str) return '';
  return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
