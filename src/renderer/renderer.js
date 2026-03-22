/**
 * ValueStream Recorder — Renderer Process v2
 * Theme switching, smooth transitions, toast notifications
 */

// ============================================================
// State
// ============================================================
const state = {
  activeTab: 'record',
  recordingMode: 'screen',
  recordingStatus: 'idle',
  recordingStartTime: null,
  steps: [],
  recording: null,
  connected: false,
  maps: [],
  theme: 'soft',
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
  uniqueWindows: new Set(),
  captureRegion: null,  // { x, y, width, height } or null for full-screen
  comparisonRecording: null, // Feature 1: the "before" recording for comparison
  monitorMode: 'primary', // Feature 3: 'primary' | 'specific' | 'follow'
  selectedDisplayId: null, // Feature 3: specific display ID
  displays: [], // Feature 3: detected displays
  // Template support
  templates: [],
  selectedTemplate: null,
  templateStepIndex: 0,
  templateEnabled: false,
  // Photo attachments pending for next capture
  pendingAttachments: []
};

// ============================================================
// Initialization
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  loadTheme();
  setupThemeToggle();
  setupTabNavigation();
  setupModeToggle();
  setupIntervalSelector();
  setupRecordingControls();
  setupRegionControls();
  setupComparisonControls();
  setupTemplateControls();
  setupAttachmentControls();
  setupMonitorControls();
  setupSyncControls();
  setupSettingsControls();
  setupKeyboardShortcuts();
  await loadSettings();
  await loadRegionState();
  await loadDisplays();
  await checkConnection();
});

// ============================================================
// Theme System
// ============================================================
function loadTheme() {
  const saved = localStorage.getItem('mapvs_recorder_theme') || 'soft';
  setTheme(saved, false);
}

function setTheme(theme, save = true) {
  state.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);

  // Update toggle buttons
  document.querySelectorAll('.theme-toggle-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === theme);
  });

  // Update settings dropdown if it exists
  const settingsTheme = document.getElementById('settingsTheme');
  if (settingsTheme) settingsTheme.value = theme;

  if (save) {
    localStorage.setItem('mapvs_recorder_theme', theme);
  }
}

function setupThemeToggle() {
  document.querySelectorAll('.theme-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => setTheme(btn.dataset.theme));
  });
}

// ============================================================
// Toast Notifications
// ============================================================
function showToast(message, type = 'info', duration = 2500) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-out');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ============================================================
// Tab Navigation
// ============================================================
function setupTabNavigation() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  document.getElementById('settingsBtn').addEventListener('click', () => switchTab('settings'));
}

function switchTab(tabId) {
  state.activeTab = tabId;

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });

  document.querySelectorAll('.tab-panel').forEach(panel => {
    const isActive = panel.id === `tab-${tabId}`;
    if (isActive && !panel.classList.contains('active')) {
      panel.classList.add('active');
      // Re-trigger animation
      panel.style.animation = 'none';
      panel.offsetHeight; // trigger reflow
      panel.style.animation = '';
    } else if (!isActive) {
      panel.classList.remove('active');
    }
  });

  if (tabId === 'review') refreshReviewTab();
  if (tabId === 'sync') refreshSyncTab();
}

// ============================================================
// Mode Toggle
// ============================================================
function setupModeToggle() {
  document.querySelectorAll('.mode-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (state.recordingStatus === 'recording') return;
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

  document.getElementById('stepNotesInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') captureManualStep();
  });
}

async function startRecording(mode) {
  try {
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
      state.templateStepIndex = 0;
      updateRecordingUI();
      startTimer();
      showToast('Recording started', 'info');

      // Show template step prompt if template is active
      if (state.templateEnabled && state.selectedTemplate) {
        updateTemplateStepPrompt();
      }

      if (mode === 'screen') {
        startStepPolling();
      }
    }
  } catch (err) {
    showToast('Failed to start recording', 'error');
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
      stopStepPolling();
      updateRecordingUI();
      showToast(`Captured ${state.steps.length} steps`, 'success');
      switchTab('review');
    }
  } catch (err) {
    showToast('Failed to stop recording', 'error');
    console.error('Failed to stop recording:', err);
  }
}

async function captureManualStep() {
  const notesInput = document.getElementById('stepNotesInput');
  const resourceInput = document.getElementById('stepResourceInput');
  const notes = notesInput.value.trim();
  const resource = resourceInput ? resourceInput.value.trim() : '';
  const attachments = [...state.pendingAttachments];

  try {
    const result = await window.api.recording.addStep({ notes, resource, attachments });
    if (result.success) {
      state.steps.push(result.data);
      if (result.data.window_title) {
        state.uniqueWindows.add(result.data.window_title);
      }
      notesInput.value = '';
      if (resourceInput) resourceInput.value = '';
      state.pendingAttachments = [];
      updatePendingAttachmentsUI();
      updateStepCounts();
      updateLatestScreenshot(result.data);
      updateRecentSteps();

      // Advance template step if using a template
      if (state.templateEnabled && state.selectedTemplate) {
        advanceTemplateStep();
      }

      // Flash the capture button
      const btn = document.getElementById('captureStepBtn');
      btn.classList.remove('btn-primary');
      btn.classList.add('btn-success');
      setTimeout(() => {
        btn.classList.remove('btn-success');
        btn.classList.add('btn-primary');
      }, 400);
    }
  } catch (err) {
    showToast('Failed to capture step', 'error');
    console.error('Failed to capture step:', err);
  }
}

function updateRecordingUI() {
  const isRecording = state.recordingStatus === 'recording';
  const isIdle = state.recordingStatus === 'idle' || state.recordingStatus === 'stopped';

  document.getElementById('screen-idle').classList.toggle('hidden', !isIdle || state.recordingMode !== 'screen');
  document.getElementById('manual-idle').classList.toggle('hidden', !isIdle || state.recordingMode !== 'manual');
  document.getElementById('recording-active').classList.toggle('hidden', !isRecording);
  document.getElementById('shortcutHints').classList.toggle('hidden', isRecording);

  if (isRecording) {
    document.getElementById('recordingModeLabel').textContent =
      state.recordingMode === 'screen' ? 'Screen Recording' : 'Manual Steps';
    document.getElementById('manualCaptureArea').classList.toggle('hidden', state.recordingMode !== 'manual');

    // Show template step prompt during manual recording
    if (state.recordingMode === 'manual' && state.templateEnabled && state.selectedTemplate) {
      updateTemplateStepPrompt();
    }
  }

  // Disable mode toggle during recording
  document.querySelectorAll('.mode-toggle-btn').forEach(btn => {
    btn.style.pointerEvents = isRecording ? 'none' : 'auto';
    btn.style.opacity = isRecording ? '0.5' : '1';
  });
}

function updateStepCounts() {
  const stepEl = document.getElementById('stepCount');
  const windowEl = document.getElementById('windowCount');

  // Animate number change
  animateValue(stepEl, state.steps.length);
  animateValue(windowEl, state.uniqueWindows.size);
}

function animateValue(element, newValue) {
  const current = parseInt(element.textContent) || 0;
  if (current === newValue) return;
  element.textContent = newValue;
  element.style.transform = 'scale(1.2)';
  element.style.transition = 'transform 0.2s cubic-bezier(0.68, -0.55, 0.265, 1.55)';
  setTimeout(() => {
    element.style.transform = 'scale(1)';
  }, 200);
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
        ${step.notes ? `<div class="text-xs text-muted mt-2">${escapeHtml(step.notes)}</div>` : ''}
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
    `${state.steps.length} steps captured \u2014 ${formatDuration(state.recording.startTime, state.recording.endTime)} total`;

  renderTimeline();
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
          <span class="step-time font-mono">${step.duration_secs ? step.duration_secs.toFixed(1) + 's' : '--'}</span>
        </div>
        <input class="step-name-input" value="${escapeAttr(step.stage_name || '')}"
          data-index="${index}" data-field="stage_name"
          placeholder="Stage name..." />
        <div class="step-app">${escapeHtml(step.app_name)} \u2014 ${escapeHtml(step.window_title)}</div>
        <input class="editable-field" value="${escapeAttr(step.notes || '')}"
          data-index="${index}" data-field="notes"
          placeholder="Add notes..." style="margin-top:4px" />
        <div class="step-resource-field">
          <svg class="resource-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          <input value="${escapeAttr(step.resource || '')}"
            data-index="${index}" data-field="resource"
            placeholder="Resource / Asset..." />
        </div>
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
        ${(step.idle_seconds > 0 || step.active_seconds > 0) ? `
        <div class="idle-breakdown">
          <span class="idle-label">Active:</span>
          <span class="idle-value">${(step.active_seconds || 0).toFixed(1)}s</span>
          <span class="idle-label">Idle:</span>
          <span class="idle-value">${(step.idle_seconds || 0).toFixed(1)}s</span>
        </div>` : ''}
        ${(step.attachments && step.attachments.length > 0) ? `
        <div class="step-attachment-thumbs">
          ${step.attachments.map((att, attIdx) => `
            <div class="step-attachment-thumb">
              <img src="file://${att}" alt="Attachment ${attIdx + 1}" />
              <button class="remove-step-attachment" data-index="${index}" data-att-index="${attIdx}" data-action="remove-attachment" title="Remove">&times;</button>
            </div>
          `).join('')}
        </div>` : ''}
      </div>
      <div class="step-actions">
        <div style="display:flex;align-items:center;gap:2px">
          <button class="va-badge ${step.va_type || 'undetermined'}" data-index="${index}" data-action="toggle-va"
            title="Click to toggle VA/NVA">
            ${step.va_type === 'va' ? 'VA' : step.va_type === 'nva' ? 'NVA' : '?'}
          </button>
          ${step.auto_classified ? `<span class="auto-badge" title="Auto-classified based on ${step.duration_secs > 0 ? Math.round((step.idle_seconds || 0) / step.duration_secs * 100) : 0}% idle time">Auto</span>` : ''}
        </div>
        <button class="icon-btn btn-sm" data-index="${index}" data-action="delete" title="Delete step"
          style="color:var(--vs-danger);width:28px;height:28px">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    </div>
  `).join('');

  // Event delegation
  list.removeEventListener('input', handleReviewInput);
  list.removeEventListener('click', handleReviewClick);
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
  } else if (field === 'resource') {
    state.steps[index].resource = e.target.value;
  } else {
    state.steps[index][field] = e.target.value;
  }

  if (state.recording) state.recording.steps = state.steps;
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
    renderTimeline();
    renderReviewSteps();
  }

  if (action === 'delete') {
    state.steps.splice(index, 1);
    state.steps.forEach((s, i) => s.order = i + 1);
    if (state.recording) state.recording.steps = state.steps;
    renderTimeline();
    renderReviewSteps();
    document.getElementById('reviewSummary').textContent = `${state.steps.length} steps captured`;
    showToast('Step removed', 'info');
  }

  if (action === 'remove-attachment') {
    const attIndex = parseInt(btn.dataset.attIndex);
    if (!isNaN(attIndex) && state.steps[index].attachments) {
      state.steps[index].attachments.splice(attIndex, 1);
      if (state.recording) state.recording.steps = state.steps;
      renderReviewSteps();
      showToast('Attachment removed', 'info');
    }
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
    showToast('Recording cleared', 'info');
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
    showToast('Disconnected', 'info');
  });

  document.getElementById('mapSelector').addEventListener('change', (e) => {
    const value = e.target.value;
    const newMapGroup = document.getElementById('newMapNameGroup');
    newMapGroup.classList.toggle('hidden', value !== '_new');
    updateUploadButton();
  });

  document.getElementById('newMapNameInput')?.addEventListener('input', updateUploadButton);
  document.getElementById('uploadBtn').addEventListener('click', uploadRecording);

  window.api.auth.onTokenReceived(async () => {
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
    showToast('Connected to MapVS.com', 'success');
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
        <option value="_new">\u002B Create New Map</option>
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

  let progress = 0;
  const progressInterval = setInterval(() => {
    progress = Math.min(progress + Math.random() * 12, 90);
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
        showToast('Upload complete!', 'success');
      }, 500);
    } else {
      throw new Error(result.error || 'Upload failed');
    }
  } catch (err) {
    clearInterval(progressInterval);
    document.getElementById('uploadProgressLabel').textContent = `Error: ${err.message}`;
    document.getElementById('uploadProgressBar').style.width = '0%';
    document.getElementById('uploadBtn').disabled = false;
    showToast(`Upload failed: ${err.message}`, 'error');
  }
}

// ============================================================
// Settings
// ============================================================
function setupSettingsControls() {
  document.getElementById('settingsAutoCapture').addEventListener('click', function() {
    this.classList.toggle('active');
  });

  document.getElementById('settingsTheme')?.addEventListener('change', function() {
    setTheme(this.value);
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

    state.settings.preferences.screenshot_interval = settings.preferences.screenshot_interval || 5000;
    document.querySelectorAll('.interval-option').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.interval) === state.settings.preferences.screenshot_interval);
    });

    // Load saved theme
    if (settings.preferences.theme) {
      setTheme(settings.preferences.theme, false);
    }
  }
}

async function saveSettings() {
  const settings = {
    api_url: document.getElementById('settingsApiUrl').value.trim(),
    preferences: {
      screenshot_interval: parseInt(document.getElementById('settingsInterval').value),
      screenshot_quality: document.getElementById('settingsQuality').value,
      auto_capture_on_window_change: document.getElementById('settingsAutoCapture').classList.contains('active'),
      theme: state.theme
    }
  };

  try {
    await window.api.settings.set(settings);
    state.settings = { ...state.settings, ...settings };
    showToast('Settings saved', 'success');
  } catch (err) {
    showToast('Failed to save settings', 'error');
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
    showToast('Local data cleared', 'info');
  } catch (err) {
    showToast('Failed to clear data', 'error');
    console.error('Failed to clear data:', err);
  }
}

// ============================================================
// Keyboard Shortcuts
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
// Step Polling (screen recording mode)
// ============================================================
let pollInterval = null;

function startStepPolling() {
  stopStepPolling();
  pollInterval = setInterval(async () => {
    if (state.recordingStatus !== 'recording' || state.recordingMode !== 'screen') {
      stopStepPolling();
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

function stopStepPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

// ============================================================
// Region Selection Controls
// ============================================================
function setupRegionControls() {
  document.getElementById('selectRegionBtn').addEventListener('click', selectRegion);
  document.getElementById('clearRegionBtn').addEventListener('click', clearRegion);
}

async function loadRegionState() {
  try {
    const result = await window.api.capture.getRegion();
    if (result.success && result.bounds) {
      state.captureRegion = result.bounds;
      updateRegionUI();
    }
  } catch (err) {
    console.error('Failed to load region state:', err);
  }
}

async function selectRegion() {
  try {
    showToast('Draw a rectangle on screen...', 'info');
    const result = await window.api.capture.selectRegion();
    if (result.success && result.bounds) {
      state.captureRegion = result.bounds;
      updateRegionUI();
      showToast(`Region set: ${result.bounds.width}x${result.bounds.height}`, 'success');
    } else if (result.cancelled) {
      showToast('Region selection cancelled', 'info');
    }
  } catch (err) {
    showToast('Failed to select region', 'error');
    console.error('Region selection failed:', err);
  }
}

async function clearRegion() {
  try {
    await window.api.capture.clearRegion();
    state.captureRegion = null;
    updateRegionUI();
    showToast('Capturing full screen', 'info');
  } catch (err) {
    showToast('Failed to clear region', 'error');
    console.error('Clear region failed:', err);
  }
}

function updateRegionUI() {
  const statusEl = document.getElementById('regionStatus');
  const statusTextEl = document.getElementById('regionStatusText');
  const clearBtn = document.getElementById('clearRegionBtn');

  if (state.captureRegion) {
    const r = state.captureRegion;
    statusTextEl.textContent = `Capturing: ${r.width}x${r.height} at (${r.x}, ${r.y})`;
    statusEl.classList.add('has-region');
    clearBtn.classList.remove('hidden');
  } else {
    statusTextEl.textContent = 'Full Screen';
    statusEl.classList.remove('has-region');
    clearBtn.classList.add('hidden');
  }
}

// ============================================================
// Process Timeline
// ============================================================
function renderTimeline() {
  const timelineBar = document.getElementById('timelineBar');
  const timelineCard = document.getElementById('timelineCard');

  if (!state.steps || state.steps.length === 0) {
    timelineCard.classList.add('hidden');
    return;
  }

  timelineCard.classList.remove('hidden');

  // Calculate totals
  const totalDuration = state.steps.reduce((sum, s) => sum + (s.duration_secs || 0), 0);
  let vaTime = 0;
  let nvaTime = 0;
  let undeterminedTime = 0;

  state.steps.forEach(s => {
    const dur = s.duration_secs || 0;
    if (s.va_type === 'va') vaTime += dur;
    else if (s.va_type === 'nva') nvaTime += dur;
    else undeterminedTime += dur;
  });

  // Update summary
  document.getElementById('timelineTotal').textContent = formatSeconds(totalDuration);
  document.getElementById('timelineVA').textContent = formatSeconds(vaTime);
  document.getElementById('timelineNVA').textContent = formatSeconds(nvaTime);
  document.getElementById('timelineWait').textContent = formatSeconds(undeterminedTime);

  // Build blocks
  if (totalDuration === 0) {
    timelineBar.innerHTML = '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--vs-text-muted)">No duration data</div>';
    return;
  }

  timelineBar.innerHTML = state.steps.map((step, index) => {
    const pct = ((step.duration_secs || 0) / totalDuration) * 100;
    const vaClass = step.va_type || 'undetermined';
    const label = step.stage_name || step.window_title || `Step ${index + 1}`;
    const thumbHtml = step.screenshot_path
      ? `<img class="timeline-tooltip-thumb" src="file://${step.screenshot_path}" alt="Step ${index + 1}" />`
      : '';

    return `
      <div class="timeline-block ${vaClass}"
           style="width:${Math.max(pct, 0.5)}%"
           data-step-index="${index}"
           title="">
        ${pct > 8 ? `<span class="timeline-block-label">${escapeHtml(label)}</span>` : ''}
        <div class="timeline-tooltip">
          <div class="timeline-tooltip-title">${escapeHtml(label)}</div>
          <div class="timeline-tooltip-row">
            <span>Duration</span>
            <span class="value">${(step.duration_secs || 0).toFixed(1)}s</span>
          </div>
          <div class="timeline-tooltip-row">
            <span>Cycle Time</span>
            <span class="value">${(step.cycle_time || 0).toFixed(1)}s</span>
          </div>
          <div class="timeline-tooltip-row">
            <span>Wait Time</span>
            <span class="value">${(step.wait_time || 0).toFixed(1)}s</span>
          </div>
          <div class="timeline-tooltip-row">
            <span>Type</span>
            <span class="value">${vaClass.toUpperCase()}</span>
          </div>
          ${thumbHtml}
        </div>
      </div>
    `;
  }).join('');

  // Click handler — scroll to corresponding step card
  timelineBar.querySelectorAll('.timeline-block').forEach(block => {
    block.addEventListener('click', () => {
      const idx = parseInt(block.dataset.stepIndex);
      const stepCards = document.querySelectorAll('#reviewStepList .step-card');
      if (stepCards[idx]) {
        stepCards[idx].scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Brief highlight
        stepCards[idx].style.boxShadow = '0 0 0 3px var(--vs-primary)';
        setTimeout(() => {
          stepCards[idx].style.boxShadow = '';
        }, 1500);
      }
    });
  });
}

function formatSeconds(totalSecs) {
  if (!totalSecs || totalSecs <= 0) return '0s';
  if (totalSecs < 60) return `${totalSecs.toFixed(1)}s`;
  const mins = Math.floor(totalSecs / 60);
  const secs = Math.round(totalSecs % 60);
  if (mins < 60) return `${mins}m ${secs}s`;
  const hrs = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hrs}h ${remainMins}m`;
}

// ============================================================
// Feature 1: Comparison Controls
// ============================================================
function setupComparisonControls() {
  document.getElementById('reviewCompareBtn')?.addEventListener('click', loadComparisonFile);
  document.getElementById('closeComparisonBtn')?.addEventListener('click', closeComparison);
}

async function loadComparisonFile() {
  try {
    const fileContent = await window.api.dialog.openFile();
    if (!fileContent) return; // User cancelled

    const data = JSON.parse(fileContent);
    if (!data.steps || !Array.isArray(data.steps)) {
      showToast('Invalid session file: no steps found', 'error');
      return;
    }
    state.comparisonRecording = data;
    renderComparison();
    showToast('Comparison loaded', 'success');
  } catch (err) {
    showToast('Failed to parse session file', 'error');
    console.error('Comparison parse error:', err);
  }
}

function closeComparison() {
  state.comparisonRecording = null;
  document.getElementById('comparisonSection').classList.add('hidden');
}

function renderComparison() {
  if (!state.comparisonRecording || !state.recording) return;

  const section = document.getElementById('comparisonSection');
  section.classList.remove('hidden');

  // compareRecordings is defined in comparison.js (loaded before renderer.js)
  const result = compareRecordings(state.comparisonRecording, state.recording);

  // Delta cards
  renderDeltaCard('deltaLeadTime', 'deltaLeadTimeValue', 'deltaLeadTimePct',
    formatSeconds(Math.abs(result.deltas.duration)),
    `${result.deltas.durationPct >= 0 ? '+' : ''}${result.deltas.durationPct.toFixed(1)}%`,
    result.deltas.duration < 0 ? 'positive' : result.deltas.duration > 0 ? 'negative' : 'neutral'
  );

  renderDeltaCard('deltaStepCount', 'deltaStepCountValue', 'deltaStepCountPct',
    `${result.deltas.stepCount >= 0 ? '+' : ''}${result.deltas.stepCount}`,
    `${result.before.stepCount} -> ${result.after.stepCount}`,
    result.deltas.stepCount < 0 ? 'positive' : result.deltas.stepCount > 0 ? 'negative' : 'neutral'
  );

  renderDeltaCard('deltaVAPct', 'deltaVAPctValue', 'deltaVAPctPct',
    `${result.deltas.vaPct >= 0 ? '+' : ''}${result.deltas.vaPct.toFixed(1)}%`,
    `${result.before.vaPct.toFixed(0)}% -> ${result.after.vaPct.toFixed(0)}%`,
    result.deltas.vaPct > 0 ? 'positive' : result.deltas.vaPct < 0 ? 'negative' : 'neutral'
  );

  renderDeltaCard('deltaOverall', 'deltaOverallValue', 'deltaOverallPct',
    `${result.overallImprovement >= 0 ? '+' : ''}${result.overallImprovement.toFixed(1)}%`,
    result.overallImprovement >= 0 ? 'improvement' : 'regression',
    result.overallImprovement > 0 ? 'positive' : result.overallImprovement < 0 ? 'negative' : 'neutral'
  );

  // Render before/after timelines
  renderComparisonTimeline('comparisonTimelineBefore', state.comparisonRecording.steps);
  renderComparisonTimeline('comparisonTimelineAfter', state.recording.steps);

  // Render step changes
  renderComparisonChanges(result);
}

function renderDeltaCard(cardId, valueId, pctId, value, pctText, polarity) {
  const card = document.getElementById(cardId);
  card.className = `delta-card delta-${polarity}`;
  document.getElementById(valueId).textContent = value;
  document.getElementById(pctId).textContent = pctText;
}

function renderComparisonTimeline(containerId, steps) {
  const container = document.getElementById(containerId);
  const totalDuration = steps.reduce((sum, s) => sum + (s.duration_secs || 0), 0);

  if (totalDuration === 0) {
    container.innerHTML = '<div style="width:100%;display:flex;align-items:center;justify-content:center;font-size:10px;color:var(--vs-text-muted)">No data</div>';
    return;
  }

  container.innerHTML = steps.map(step => {
    const pct = ((step.duration_secs || 0) / totalDuration) * 100;
    const vaClass = step.va_type || 'undetermined';
    return `<div class="timeline-block ${vaClass}" style="width:${Math.max(pct, 0.5)}%"></div>`;
  }).join('');
}

function renderComparisonChanges(result) {
  const container = document.getElementById('comparisonChanges');
  const items = [];

  for (const match of result.removed) {
    items.push(`<div class="comparison-change-item">
      <span class="comparison-change-badge removed">Removed</span>
      <span>${escapeHtml(match.before.stage_name || 'Unnamed step')}</span>
    </div>`);
  }

  for (const match of result.added) {
    items.push(`<div class="comparison-change-item">
      <span class="comparison-change-badge added">Added</span>
      <span>${escapeHtml(match.after.stage_name || 'Unnamed step')}</span>
    </div>`);
  }

  for (const match of result.changed) {
    const delta = match.durationDelta || 0;
    const sign = delta >= 0 ? '+' : '';
    items.push(`<div class="comparison-change-item">
      <span class="comparison-change-badge changed">Changed</span>
      <span>${escapeHtml(match.before.stage_name || 'Unnamed step')} (${sign}${delta.toFixed(1)}s)</span>
    </div>`);
  }

  if (items.length === 0) {
    container.innerHTML = '<div class="text-sm text-muted">No step changes detected.</div>';
  } else {
    container.innerHTML = items.join('');
  }
}

// ============================================================
// Feature 3: Monitor Controls
// ============================================================
function setupMonitorControls() {
  document.querySelectorAll('input[name="monitorMode"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      state.monitorMode = e.target.value;
      const monitorSelect = document.getElementById('monitorSelect');
      monitorSelect.classList.toggle('hidden', e.target.value !== 'specific');
      applyMonitorSettings();
    });
  });

  document.getElementById('monitorSelect')?.addEventListener('change', (e) => {
    state.selectedDisplayId = e.target.value ? parseInt(e.target.value) : null;
    applyMonitorSettings();
    updateMonitorLayoutHighlight();
  });
}

async function loadDisplays() {
  try {
    const displays = await window.api.capture.getDisplays();
    state.displays = displays || [];
    renderMonitorLayout();

    // Load saved settings
    const settings = await window.api.capture.getDisplaySettings();
    if (settings.followActiveWindow) {
      state.monitorMode = 'follow';
      document.getElementById('monitorModeFollow').checked = true;
    } else if (settings.displayId) {
      state.monitorMode = 'specific';
      state.selectedDisplayId = settings.displayId;
      document.getElementById('monitorModeSpecific').checked = true;
      document.getElementById('monitorSelect').classList.remove('hidden');
      document.getElementById('monitorSelect').value = settings.displayId;
    }
    updateMonitorLayoutHighlight();
  } catch (err) {
    console.error('Failed to load displays:', err);
  }
}

function renderMonitorLayout() {
  const container = document.getElementById('monitorLayout');
  const select = document.getElementById('monitorSelect');

  if (!state.displays || state.displays.length === 0) {
    container.innerHTML = '<div class="text-xs text-muted">No displays detected</div>';
    return;
  }

  // Find min/max bounds for proportional rendering
  let minX = Infinity, minY = Infinity, maxRight = -Infinity, maxBottom = -Infinity;
  state.displays.forEach(d => {
    minX = Math.min(minX, d.bounds.x);
    minY = Math.min(minY, d.bounds.y);
    maxRight = Math.max(maxRight, d.bounds.x + d.bounds.width);
    maxBottom = Math.max(maxBottom, d.bounds.y + d.bounds.height);
  });

  const totalWidth = maxRight - minX;
  const totalHeight = maxBottom - minY;
  const scale = Math.min(300 / totalWidth, 100 / totalHeight);

  container.innerHTML = state.displays.map(d => {
    const w = Math.round(d.bounds.width * scale);
    const h = Math.round(d.bounds.height * scale);
    const primaryClass = d.isPrimary ? 'primary' : '';
    return `
      <div class="monitor-rect ${primaryClass}" data-display-id="${d.id}"
           style="width:${w}px;height:${h}px">
        <span class="monitor-rect-label">${escapeHtml(d.label)}</span>
        <span class="monitor-rect-size">${d.bounds.width}x${d.bounds.height}</span>
      </div>
    `;
  }).join('');

  // Click to select
  container.querySelectorAll('.monitor-rect').forEach(rect => {
    rect.addEventListener('click', () => {
      const displayId = parseInt(rect.dataset.displayId);
      state.selectedDisplayId = displayId;
      state.monitorMode = 'specific';
      document.getElementById('monitorModeSpecific').checked = true;
      document.getElementById('monitorSelect').classList.remove('hidden');
      document.getElementById('monitorSelect').value = displayId;
      updateMonitorLayoutHighlight();
      applyMonitorSettings();
    });
  });

  // Populate select dropdown
  select.innerHTML = `<option value="">Select display...</option>` +
    state.displays.map(d =>
      `<option value="${d.id}">${escapeHtml(d.label)}${d.isPrimary ? ' (Primary)' : ''} - ${d.bounds.width}x${d.bounds.height}</option>`
    ).join('');
}

function updateMonitorLayoutHighlight() {
  const container = document.getElementById('monitorLayout');
  container.querySelectorAll('.monitor-rect').forEach(rect => {
    const id = parseInt(rect.dataset.displayId);
    const isActive = state.monitorMode === 'specific' && state.selectedDisplayId === id;
    const isPrimaryActive = state.monitorMode === 'primary' && rect.classList.contains('primary');
    rect.classList.toggle('active', isActive || isPrimaryActive);
  });
}

async function applyMonitorSettings() {
  try {
    if (state.monitorMode === 'follow') {
      await window.api.capture.setFollowActiveWindow(true);
      await window.api.capture.setActiveDisplay(null);
    } else if (state.monitorMode === 'specific' && state.selectedDisplayId) {
      await window.api.capture.setFollowActiveWindow(false);
      await window.api.capture.setActiveDisplay(state.selectedDisplayId);
    } else {
      // primary
      await window.api.capture.setFollowActiveWindow(false);
      await window.api.capture.setActiveDisplay(null);
    }
    updateMonitorLayoutHighlight();
  } catch (err) {
    console.error('Failed to apply monitor settings:', err);
  }
}

// ============================================================
// Feature: Photo Attachment Controls
// ============================================================
function setupAttachmentControls() {
  document.getElementById('attachPhotoBtn')?.addEventListener('click', attachPhoto);
}

async function attachPhoto() {
  try {
    const filePath = await window.api.capture.attachFile();
    if (!filePath) return;

    state.pendingAttachments.push(filePath);
    updatePendingAttachmentsUI();
    showToast('Photo attached', 'success');
  } catch (err) {
    showToast('Failed to attach photo', 'error');
    console.error('Attach photo error:', err);
  }
}

function updatePendingAttachmentsUI() {
  const container = document.getElementById('pendingAttachments');
  if (!container) return;

  if (state.pendingAttachments.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = state.pendingAttachments.map((filePath, idx) => `
    <div class="pending-attachment">
      <img src="file://${filePath}" alt="Attachment ${idx + 1}" />
      <button class="remove-attachment" data-att-idx="${idx}" title="Remove">&times;</button>
    </div>
  `).join('');

  container.querySelectorAll('.remove-attachment').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.target.dataset.attIdx);
      state.pendingAttachments.splice(idx, 1);
      updatePendingAttachmentsUI();
    });
  });
}

// ============================================================
// Feature: Guided Recording Templates
// ============================================================
function setupTemplateControls() {
  const toggle = document.getElementById('templateToggle');
  if (!toggle) return;

  toggle.addEventListener('click', () => {
    state.templateEnabled = !state.templateEnabled;
    toggle.classList.toggle('active', state.templateEnabled);

    const picker = document.getElementById('templatePicker');
    picker.classList.toggle('hidden', !state.templateEnabled);

    if (state.templateEnabled && state.connected && state.templates.length === 0) {
      loadTemplates();
    }
  });

  document.getElementById('templateSearchInput')?.addEventListener('input', (e) => {
    filterTemplates(e.target.value.trim().toLowerCase());
  });
}

async function loadTemplates() {
  try {
    const result = await window.api.sync.getTemplates();
    if (result.success && Array.isArray(result.data)) {
      state.templates = result.data;
      renderTemplateList();
    } else {
      renderTemplateListFallback();
    }
  } catch (err) {
    console.error('Failed to load templates:', err);
    renderTemplateListFallback();
  }
}

function renderTemplateListFallback() {
  // Show built-in sample templates when not connected
  state.templates = [
    {
      id: 'builtin-1',
      name: 'Generic Process Walk',
      industry: 'General',
      steps: [
        { name: 'Start / Trigger', description: 'What initiates this process?' },
        { name: 'Input Preparation', description: 'Gather inputs and materials' },
        { name: 'Core Processing', description: 'The main work activity' },
        { name: 'Quality Check', description: 'Inspect or verify output' },
        { name: 'Handoff / Delivery', description: 'Pass to next person or system' }
      ]
    },
    {
      id: 'builtin-2',
      name: 'Office Admin Process',
      industry: 'Admin',
      steps: [
        { name: 'Request Received', description: 'Email, form, or verbal request arrives' },
        { name: 'Open System', description: 'Log into required application' },
        { name: 'Data Entry', description: 'Enter or update information' },
        { name: 'Approval / Review', description: 'Get sign-off or check work' },
        { name: 'Notification Sent', description: 'Confirm completion to requestor' }
      ]
    },
    {
      id: 'builtin-3',
      name: 'Field Service Task',
      industry: 'Field Services',
      steps: [
        { name: 'Receive Work Order', description: 'Job assigned via dispatch' },
        { name: 'Travel to Site', description: 'Drive or transit to location' },
        { name: 'Site Assessment', description: 'Inspect and assess the work' },
        { name: 'Perform Work', description: 'Execute the task' },
        { name: 'Document & Close', description: 'Take photos, complete paperwork' }
      ]
    }
  ];
  renderTemplateList();
}

function renderTemplateList() {
  const container = document.getElementById('templateList');
  if (!state.templates || state.templates.length === 0) {
    container.innerHTML = '<div class="text-xs text-muted" style="padding:12px;text-align:center">No templates available</div>';
    return;
  }

  // Group by industry
  const groups = {};
  state.templates.forEach(t => {
    const industry = t.industry || 'Other';
    if (!groups[industry]) groups[industry] = [];
    groups[industry].push(t);
  });

  container.innerHTML = Object.entries(groups).map(([industry, templates]) => `
    <div class="template-list-group" data-industry="${escapeAttr(industry.toLowerCase())}">
      <div class="template-list-group-title">${escapeHtml(industry)}</div>
      ${templates.map(t => `
        <div class="template-list-item" data-template-id="${escapeAttr(t.id)}" data-name="${escapeAttr(t.name.toLowerCase())}">
          <span>${escapeHtml(t.name)}</span>
          <span class="template-list-item-steps">${t.steps ? t.steps.length : 0} steps</span>
        </div>
      `).join('')}
    </div>
  `).join('');

  // Click to select
  container.querySelectorAll('.template-list-item').forEach(item => {
    item.addEventListener('click', () => {
      const templateId = item.dataset.templateId;
      const template = state.templates.find(t => t.id === templateId);
      if (template) selectTemplate(template);

      // Highlight selected
      container.querySelectorAll('.template-list-item').forEach(i => i.classList.remove('selected'));
      item.classList.add('selected');
    });
  });
}

function filterTemplates(query) {
  const items = document.querySelectorAll('#templateList .template-list-item');
  const groups = document.querySelectorAll('#templateList .template-list-group');

  if (!query) {
    items.forEach(i => i.style.display = '');
    groups.forEach(g => g.style.display = '');
    return;
  }

  groups.forEach(group => {
    let hasVisible = false;
    group.querySelectorAll('.template-list-item').forEach(item => {
      const name = item.dataset.name || '';
      const visible = name.includes(query);
      item.style.display = visible ? '' : 'none';
      if (visible) hasVisible = true;
    });
    group.style.display = hasVisible ? '' : 'none';
  });
}

function selectTemplate(template) {
  state.selectedTemplate = template;
  state.templateStepIndex = 0;

  // Show template info
  const infoEl = document.getElementById('selectedTemplateInfo');
  infoEl.classList.remove('hidden');
  document.getElementById('selectedTemplateName').textContent = template.name;

  // Render checklist
  renderTemplateChecklist();
}

function renderTemplateChecklist() {
  const container = document.getElementById('templateChecklist');
  if (!state.selectedTemplate) return;

  container.innerHTML = state.selectedTemplate.steps.map((step, idx) => `
    <div class="template-checklist-item ${idx < state.templateStepIndex ? 'completed' : ''}" data-step-idx="${idx}">
      <div class="check-icon"></div>
      <span>${escapeHtml(step.name)}</span>
    </div>
  `).join('');
}

function advanceTemplateStep() {
  if (!state.selectedTemplate) return;

  state.templateStepIndex++;
  renderTemplateChecklist();
  updateTemplateStepPrompt();

  if (state.templateStepIndex >= state.selectedTemplate.steps.length) {
    showToast('Template complete!', 'success');
  }
}

function updateTemplateStepPrompt() {
  const promptEl = document.getElementById('templateStepPrompt');
  const badgeEl = document.getElementById('templateStepBadge');
  const nameEl = document.getElementById('templateStepName');

  if (!state.templateEnabled || !state.selectedTemplate || state.templateStepIndex >= state.selectedTemplate.steps.length) {
    promptEl.classList.add('hidden');
    return;
  }

  const currentStep = state.selectedTemplate.steps[state.templateStepIndex];
  promptEl.classList.remove('hidden');
  badgeEl.textContent = `Step ${state.templateStepIndex + 1}`;
  nameEl.textContent = currentStep.name;
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
