/**
 * ValueStream Recorder — Renderer Process v2
 * Theme switching, smooth transitions, toast notifications
 */

// ============================================================
// Error Reporting (forwards to Sentry via API)
// ============================================================
window.addEventListener('error', (e) => {
  reportError(e.message, 'uncaught_error', e.filename + ':' + e.lineno);
});
window.addEventListener('unhandledrejection', (e) => {
  reportError(String(e.reason), 'unhandled_promise', '');
});

async function reportError(message, context, detail) {
  try {
    const apiUrl = localStorage.getItem('mapvs_api_url') || 'https://mapvs.com/api/v1';
    const token = localStorage.getItem('mapvs_token') || '';
    await fetch(apiUrl + '/client-error', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': 'Bearer ' + token } : {}),
      },
      body: JSON.stringify({
        platform: 'desktop',
        error: message,
        context: context + (detail ? ' | ' + detail : ''),
        device: navigator.platform,
        os: navigator.userAgent,
        app_version: '1.0.0',
        timestamp: new Date().toISOString(),
      }),
    });
  } catch {} // Don't let error reporting cause more errors
}

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
  pendingAttachments: [],
  // Notification polling
  notificationCount: 0,
  notificationPollInterval: null,
  notifications: [],
  notificationPanelOpen: false,
  // Quick stats
  quickStats: { total_maps: 0 },
  // Runs history
  runsHistory: [],
  selectedRunMapId: null,
  // Auto-sync
  autoSyncInterval: null
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
  setupAutoUpdate();
  setupKeyboardShortcuts();
  setupNotificationControls();
  setupDeleteRecordingControls();
  setupQuickSimulate();
  setupRunHistoryControls();
  setupStepTriggers();
  setupAnnotateTab();
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
  if (tabId === 'settings') loadDeletedRecordings();
  if (tabId === 'annotate') refreshAnnotateMapDropdown();
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

      // Start region change detection if enabled
      if (state.regionTriggersEnabled && state.regionTriggers.length > 0) {
        startRegionChangeDetection();
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
      stopRegionChangeDetection();
      updateRecordingUI();
      showToast(`Captured ${state.steps.length} steps`, 'success');
      onRecordingComplete();
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

  renderAnalyticsSummary();
  renderTimeline();
  renderReviewSteps();
  updateQuickSimulateVisibility();

  // Load run history if connected and a map is selected
  if (state.connected) {
    refreshRunHistoryPanel();
  }
}

function refreshRunHistoryPanel() {
  const panel = document.getElementById('runHistoryPanel');
  if (!panel) return;

  if (!state.connected) {
    panel.classList.add('hidden');
    return;
  }

  panel.classList.remove('hidden');

  // Populate map selector for run history
  const selector = document.getElementById('runHistoryMapSelector');
  if (selector && state.maps.length > 0) {
    const currentVal = selector.value;
    selector.innerHTML = `<option value="">Select a map...</option>` +
      state.maps.map(m => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('');
    if (currentVal) selector.value = currentVal;
  }
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
        <button class="flag-change-btn ${step.change_flag ? 'flagged' : ''}" data-index="${index}" data-action="flag-change" title="Flag process change">
          <span class="flag-dot"></span>
          Flag
        </button>
        ${step.change_flag ? `
        <div class="change-flag-info">
          <span class="change-flag-type">${escapeHtml(step.change_flag.type || '')}</span>
          <span class="change-flag-note">${escapeHtml(step.change_flag.note || '')}</span>
        </div>` : ''}
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

  if (action === 'flag-change') {
    showChangeFlagDialog(index);
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
    // Fetch presence when a map is selected
    if (value && value !== '' && value !== '_new') {
      pollMapPresence(value);
    } else {
      clearMapPresence();
    }
  });

  document.getElementById('newMapNameInput')?.addEventListener('input', updateUploadButton);
  document.getElementById('uploadBtn').addEventListener('click', uploadRecording);

  window.api.auth.onTokenReceived(async () => {
    await checkConnection();
  });

  // Header sign-in button
  const headerSignIn = document.getElementById('headerSignInBtn');
  if (headerSignIn) headerSignIn.addEventListener('click', () => window.api.auth.login());

  // Banner sign-in button
  const bannerSignIn = document.getElementById('bannerSignInBtn');
  if (bannerSignIn) bannerSignIn.addEventListener('click', () => window.api.auth.login());

  // Banner register button
  const bannerRegister = document.getElementById('bannerRegisterBtn');
  if (bannerRegister) bannerRegister.addEventListener('click', async () => {
    const settings = await window.api.settings.get();
    const baseUrl = settings.api_url?.replace('/api/v1', '') || 'https://mapvs.com';
    window.api.system.openExternal(`${baseUrl}/auth/register`);
  });

  // Annotate web link
  const openWebAnnotate = document.getElementById('openWebAnnotateBtn');
  if (openWebAnnotate) openWebAnnotate.addEventListener('click', async () => {
    const settings = await window.api.settings.get();
    const baseUrl = settings.api_url?.replace('/api/v1', '') || 'https://mapvs.com';
    window.api.system.openExternal(`${baseUrl}/video/`);
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

  // Show/hide header sign-in button and prompt banner
  const signInBtn = document.getElementById('headerSignInBtn');
  const banner = document.getElementById('signInPromptBanner');
  if (signInBtn) signInBtn.style.display = state.connected ? 'none' : 'flex';
  if (banner) banner.classList.toggle('hidden', state.connected);

  if (state.connected) {
    loadMaps();
    startNotificationPolling();
    startAutoSync();
    fetchQuickStats();
    showToast('Connected to MapVS.com', 'success');
  } else {
    stopNotificationPolling();
    stopAutoSync();
    document.getElementById('headerQuickStats').classList.add('hidden');
    document.getElementById('notificationBadge').classList.add('hidden');
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
      const runNumber = result.data?.run_number || result.data?.run_id;
      const apiUrl = state.settings.api_url.replace('/api/v1', '');
      document.getElementById('viewMapLink').href = `${apiUrl}/maps/${mapResultId}`;

      setTimeout(() => {
        document.getElementById('uploadProgress').classList.add('hidden');
        document.getElementById('uploadSuccess').classList.remove('hidden');
        const toastMsg = runNumber
          ? `Uploaded as Run #${runNumber}`
          : 'Upload complete!';
        showToast(toastMsg, 'success');
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
// Map Presence (Collaborative Editing #34)
// ============================================================
let _presencePollTimer = null;

function pollMapPresence(mapId) {
  clearMapPresence();
  fetchPresence(mapId);
  _presencePollTimer = setInterval(() => fetchPresence(mapId), 15000);
}

function clearMapPresence() {
  if (_presencePollTimer) {
    clearInterval(_presencePollTimer);
    _presencePollTimer = null;
  }
  const el = document.getElementById('mapPresenceInfo');
  if (el) el.classList.add('hidden');
}

async function fetchPresence(mapId) {
  const el = document.getElementById('mapPresenceInfo');
  if (!el || !state.connected) return;

  try {
    const result = await window.api.sync.getMapPresence(mapId);
    if (result && result.active_users && result.active_users.length > 0) {
      const names = result.active_users.map(u => u.user_name || 'Unknown').join(', ');
      el.textContent = `${result.count} viewing: ${names}`;
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  } catch {
    el.classList.add('hidden');
  }
}

// ============================================================
// Auto-Update
// ============================================================
function setupAutoUpdate() {
  const banner = document.getElementById('updateBanner');
  const bannerText = document.getElementById('updateBannerText');
  const progressContainer = document.getElementById('updateProgress');
  const progressBar = document.getElementById('updateProgressBar');
  const restartBtn = document.getElementById('updateRestartBtn');
  const dismissBtn = document.getElementById('updateDismissBtn');
  const checkBtn = document.getElementById('checkUpdateBtn');
  const statusText = document.getElementById('updateStatusText');
  const versionLabel = document.getElementById('appVersionLabel');

  // Display current version
  if (window.api.app) {
    window.api.app.getVersion().then((version) => {
      if (versionLabel) versionLabel.textContent = `ValueStream Recorder v${version}`;
    });
  }

  // "Check for Updates" button in Settings
  if (checkBtn) {
    checkBtn.addEventListener('click', async () => {
      checkBtn.disabled = true;
      checkBtn.textContent = 'Checking...';
      if (statusText) statusText.textContent = 'Checking for updates...';
      try {
        const result = await window.api.app.checkUpdate();
        if (result.success && result.updateInfo) {
          if (statusText) statusText.textContent = `Update v${result.updateInfo.version} available`;
        } else {
          if (statusText) statusText.textContent = 'Up to date';
          showToast('You are running the latest version', 'success');
        }
      } catch (err) {
        if (statusText) statusText.textContent = 'Update check failed';
        showToast('Could not check for updates', 'error');
      }
      checkBtn.disabled = false;
      checkBtn.textContent = 'Check for Updates';
    });
  }

  // Restart button on banner
  if (restartBtn) {
    restartBtn.addEventListener('click', () => {
      window.api.app.installUpdate();
    });
  }

  // Dismiss banner
  if (dismissBtn) {
    dismissBtn.addEventListener('click', () => {
      banner.classList.add('hidden');
    });
  }

  // Listen for update events from main process
  if (window.api.app) {
    window.api.app.onUpdateAvailable((info) => {
      banner.classList.remove('hidden');
      bannerText.textContent = `Downloading update v${info.version}...`;
      progressContainer.classList.remove('hidden');
      restartBtn.classList.add('hidden');
      if (statusText) statusText.textContent = `Downloading v${info.version}...`;
    });

    window.api.app.onDownloadProgress((progress) => {
      const pct = Math.round(progress.percent);
      progressBar.style.width = `${pct}%`;
      bannerText.textContent = `Downloading update... ${pct}%`;
    });

    window.api.app.onUpdateDownloaded((info) => {
      banner.classList.remove('hidden');
      bannerText.textContent = `Update v${info.version} ready — restart to apply`;
      progressContainer.classList.add('hidden');
      restartBtn.classList.remove('hidden');
      restartBtn.style.display = '';
      if (statusText) statusText.textContent = `v${info.version} ready — restart to apply`;
    });
  }
}

// ============================================================
// Settings
// ============================================================
function setupSettingsControls() {
  document.getElementById('settingsAutoCapture').addEventListener('click', function() {
    this.classList.toggle('active');
  });

  document.getElementById('settingsCompactMode')?.addEventListener('click', function() {
    this.classList.toggle('active');
  });

  document.getElementById('settingsAutoSync')?.addEventListener('click', function() {
    this.classList.toggle('active');
    if (this.classList.contains('active')) {
      startAutoSync();
    } else {
      stopAutoSync();
    }
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

    // Recording mode
    const recordingModeEl = document.getElementById('settingsRecordingMode');
    if (recordingModeEl && settings.preferences.recording_mode) {
      recordingModeEl.value = settings.preferences.recording_mode;
    }

    // Compact mode
    const compactBtn = document.getElementById('settingsCompactMode');
    if (compactBtn) {
      compactBtn.classList.toggle('active', !!settings.preferences.compact_mode);
    }

    // Auto-sync
    const autoSyncBtn = document.getElementById('settingsAutoSync');
    if (autoSyncBtn) {
      autoSyncBtn.classList.toggle('active', settings.preferences.auto_sync !== false);
    }

    // Sync frequency
    const syncFreqEl = document.getElementById('settingsSyncFrequency');
    if (syncFreqEl && settings.preferences.sync_frequency !== undefined) {
      syncFreqEl.value = settings.preferences.sync_frequency;
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
      theme: state.theme,
      recording_mode: document.getElementById('settingsRecordingMode')?.value || 'manual',
      compact_mode: document.getElementById('settingsCompactMode')?.classList.contains('active') || false,
      auto_sync: document.getElementById('settingsAutoSync')?.classList.contains('active') !== false,
      sync_frequency: parseInt(document.getElementById('settingsSyncFrequency')?.value || '300000'),
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
// Step Triggers — Key + Region Detection
// ============================================================
// State for step triggers
state.keyTriggers = [];        // [{id, key, display, action}]
state.regionTriggers = [];     // [{id, name, bounds:{x,y,w,h}, enabled}]
state.keyTriggersEnabled = true;
state.regionTriggersEnabled = false;
state.keyTriggerCounter = 0;
state.regionTriggerCounter = 0;
state.regionCheckInterval = null;
state.regionBaselines = {};    // {id: imageData}

function setupStepTriggers() {
  // Key triggers toggle
  document.getElementById('keyTriggersEnabled')?.addEventListener('change', (e) => {
    state.keyTriggersEnabled = e.target.checked;
  });

  // Region triggers toggle
  document.getElementById('regionTriggersEnabled')?.addEventListener('change', (e) => {
    state.regionTriggersEnabled = e.target.checked;
  });

  // Add key trigger button
  document.getElementById('addKeyTriggerBtn')?.addEventListener('click', openKeyCaptureModal);

  // Add region trigger button
  document.getElementById('addRegionTriggerBtn')?.addEventListener('click', openRegionDetectModal);

  // Key capture modal
  document.getElementById('keyCaptureCancel')?.addEventListener('click', closeKeyCaptureModal);
  document.getElementById('keyCaptureConfirm')?.addEventListener('click', confirmKeyCapture);

  // Region detect modal
  document.getElementById('regionDetectCancel')?.addEventListener('click', closeRegionDetectModal);
  document.getElementById('regionDetectConfirm')?.addEventListener('click', confirmRegionDetect);

  // Global keydown listener for step triggers during recording
  document.addEventListener('keydown', handleStepTriggerKeydown);

  // Render initial lists
  renderKeyTriggerList();
  renderRegionTriggerList();
}

// --- Key Trigger Capture ---
let capturedKey = null;

function openKeyCaptureModal() {
  capturedKey = null;
  document.getElementById('keyCaptureModal').classList.remove('hidden');
  document.getElementById('keyCaptureDisplay').textContent = 'Waiting...';
  document.getElementById('keyCaptureConfirm').disabled = true;

  const handler = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') {
      closeKeyCaptureModal();
      document.removeEventListener('keydown', handler, true);
      return;
    }
    const parts = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.metaKey) parts.push('Cmd');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    if (!['Control', 'Meta', 'Alt', 'Shift'].includes(e.key)) {
      parts.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);
    }
    const display = parts.join('+');
    if (parts.length > 0 && !['Control', 'Meta', 'Alt', 'Shift'].includes(parts[parts.length - 1])) {
      capturedKey = { key: e.key, ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey, shift: e.shiftKey, display };
      document.getElementById('keyCaptureDisplay').textContent = display;
      document.getElementById('keyCaptureConfirm').disabled = false;
      document.removeEventListener('keydown', handler, true);
    }
  };
  document.addEventListener('keydown', handler, true);
}

function closeKeyCaptureModal() {
  document.getElementById('keyCaptureModal').classList.add('hidden');
  capturedKey = null;
}

function confirmKeyCapture() {
  if (!capturedKey) return;
  state.keyTriggerCounter++;
  const action = document.getElementById('keyCaptureAction').value;
  state.keyTriggers.push({
    id: state.keyTriggerCounter,
    key: capturedKey.key,
    ctrl: capturedKey.ctrl,
    meta: capturedKey.meta,
    alt: capturedKey.alt,
    shift: capturedKey.shift,
    display: capturedKey.display,
    action: action,
  });
  closeKeyCaptureModal();
  renderKeyTriggerList();
  showToast(`Key trigger "${capturedKey.display}" added`, 'success');
}

function renderKeyTriggerList() {
  const list = document.getElementById('keyTriggerList');
  if (!list) return;
  if (state.keyTriggers.length === 0) {
    list.innerHTML = '<div class="text-xs text-muted" style="padding:4px 0">No key triggers configured</div>';
    return;
  }
  const actionLabels = { 'new-step': 'New step', 'complete-step': 'Complete step', 'toggle-va': 'Toggle VA/NVA' };
  list.innerHTML = state.keyTriggers.map(t => `
    <div class="trigger-item" data-id="${t.id}">
      <span class="kbd">${escapeHtml(t.display)}</span>
      <span class="text-xs text-muted">${actionLabels[t.action] || t.action}</span>
      <button class="icon-btn btn-sm remove-key-trigger" data-id="${t.id}" title="Remove" style="margin-left:auto;width:22px;height:22px;color:var(--vs-danger)">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  `).join('');

  list.querySelectorAll('.remove-key-trigger').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.dataset.id);
      state.keyTriggers = state.keyTriggers.filter(t => t.id !== id);
      renderKeyTriggerList();
    });
  });
}

function handleStepTriggerKeydown(e) {
  if (state.recordingStatus !== 'recording') return;
  if (!state.keyTriggersEnabled) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

  for (const trigger of state.keyTriggers) {
    const keyMatch = e.key === trigger.key || e.key.toUpperCase() === trigger.key.toUpperCase();
    const modMatch = (!!e.ctrlKey === !!trigger.ctrl) && (!!e.metaKey === !!trigger.meta) &&
                     (!!e.altKey === !!trigger.alt) && (!!e.shiftKey === !!trigger.shift);
    if (keyMatch && modMatch) {
      e.preventDefault();
      executeTriggerAction(trigger.action);
      return;
    }
  }
}

async function executeTriggerAction(action) {
  if (state.recordingStatus !== 'recording') return;

  if (action === 'new-step') {
    try {
      const result = await window.api.recording.addStep({ notes: '[auto: key trigger]' });
      if (result.success) {
        state.steps.push(result.data);
        updateStepCounts();
        updateLatestScreenshot(result.data);
        updateRecentSteps();
        showToast('Step triggered by key', 'info', 1500);
      }
    } catch (err) {
      console.error('Key trigger step failed:', err);
    }
  } else if (action === 'complete-step') {
    // Same as new-step in our model (marks boundary)
    try {
      const result = await window.api.recording.addStep({ notes: '[auto: step complete trigger]' });
      if (result.success) {
        state.steps.push(result.data);
        updateStepCounts();
        showToast('Step completed by trigger', 'info', 1500);
      }
    } catch (err) {
      console.error('Key trigger complete failed:', err);
    }
  } else if (action === 'toggle-va') {
    // Toggle VA/NVA on most recent step
    if (state.steps.length > 0) {
      const last = state.steps[state.steps.length - 1];
      const cycle = ['undetermined', 'va', 'nva'];
      const current = last.va_type || 'undetermined';
      last.va_type = cycle[(cycle.indexOf(current) + 1) % cycle.length];
      showToast(`Step marked ${last.va_type.toUpperCase()}`, 'info', 1500);
    }
  }
}

// --- Region Detection Triggers ---
let regionDrawState = { drawing: false, startX: 0, startY: 0, endX: 0, endY: 0, screenshotImg: null };

async function openRegionDetectModal() {
  document.getElementById('regionDetectModal').classList.remove('hidden');
  document.getElementById('regionDetectConfirm').disabled = true;
  document.getElementById('regionDetectName').value = `Region ${state.regionTriggerCounter + 1}`;

  // Capture a screenshot for preview
  try {
    const result = await window.api.capture.screenshot();
    if (result.success && result.path) {
      const canvas = document.getElementById('regionDetectCanvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();
      img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        regionDrawState.screenshotImg = img;
        setupRegionDrawHandlers(canvas);
      };
      img.src = `file://${result.path}`;
    }
  } catch (err) {
    console.error('Screenshot for region detect failed:', err);
  }
}

function setupRegionDrawHandlers(canvas) {
  const ctx = canvas.getContext('2d');
  let drawing = false;

  const getPos = (e) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  };

  const onDown = (e) => {
    drawing = true;
    const pos = getPos(e);
    regionDrawState.startX = pos.x;
    regionDrawState.startY = pos.y;
  };

  const onMove = (e) => {
    if (!drawing) return;
    const pos = getPos(e);
    regionDrawState.endX = pos.x;
    regionDrawState.endY = pos.y;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (regionDrawState.screenshotImg) ctx.drawImage(regionDrawState.screenshotImg, 0, 0);
    const x = Math.min(regionDrawState.startX, pos.x);
    const y = Math.min(regionDrawState.startY, pos.y);
    const w = Math.abs(pos.x - regionDrawState.startX);
    const h = Math.abs(pos.y - regionDrawState.startY);
    ctx.strokeStyle = '#F97316';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 3]);
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = 'rgba(249,115,22,0.15)';
    ctx.fillRect(x, y, w, h);
  };

  const onUp = () => {
    drawing = false;
    const x = Math.min(regionDrawState.startX, regionDrawState.endX);
    const y = Math.min(regionDrawState.startY, regionDrawState.endY);
    const w = Math.abs(regionDrawState.endX - regionDrawState.startX);
    const h = Math.abs(regionDrawState.endY - regionDrawState.startY);
    if (w > 5 && h > 5) {
      regionDrawState.bounds = {
        x: x / canvas.width, y: y / canvas.height,
        w: w / canvas.width, h: h / canvas.height,
      };
      document.getElementById('regionDetectConfirm').disabled = false;

      // Redraw with solid line
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (regionDrawState.screenshotImg) ctx.drawImage(regionDrawState.screenshotImg, 0, 0);
      ctx.strokeStyle = '#F97316';
      ctx.lineWidth = 3;
      ctx.setLineDash([]);
      ctx.strokeRect(x, y, w, h);
      ctx.fillStyle = 'rgba(249,115,22,0.1)';
      ctx.fillRect(x, y, w, h);
      ctx.font = '14px sans-serif';
      ctx.fillStyle = '#F97316';
      ctx.fillText('Detection Region', x + 6, y + 18);
    }
  };

  // Remove old handlers
  canvas.onmousedown = onDown;
  canvas.onmousemove = onMove;
  canvas.onmouseup = onUp;
}

function closeRegionDetectModal() {
  document.getElementById('regionDetectModal').classList.add('hidden');
  regionDrawState = { drawing: false, startX: 0, startY: 0, endX: 0, endY: 0, screenshotImg: null };
}

function confirmRegionDetect() {
  if (!regionDrawState.bounds) return;
  state.regionTriggerCounter++;
  const name = document.getElementById('regionDetectName').value.trim() || `Region ${state.regionTriggerCounter}`;
  state.regionTriggers.push({
    id: state.regionTriggerCounter,
    name: name,
    bounds: { ...regionDrawState.bounds },
    enabled: true,
  });
  closeRegionDetectModal();
  renderRegionTriggerList();
  showToast(`Region trigger "${name}" added`, 'success');
}

function renderRegionTriggerList() {
  const list = document.getElementById('regionTriggerList');
  if (!list) return;
  if (state.regionTriggers.length === 0) {
    list.innerHTML = '<div class="text-xs text-muted" style="padding:4px 0">No region triggers configured</div>';
    return;
  }
  list.innerHTML = state.regionTriggers.map(t => `
    <div class="trigger-item" data-id="${t.id}">
      <span class="text-xs font-semibold" style="color:var(--vs-primary)">${escapeHtml(t.name)}</span>
      <span class="text-xs text-muted">${Math.round(t.bounds.w * 100)}% x ${Math.round(t.bounds.h * 100)}%</span>
      <button class="icon-btn btn-sm remove-region-trigger" data-id="${t.id}" title="Remove" style="margin-left:auto;width:22px;height:22px;color:var(--vs-danger)">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  `).join('');

  list.querySelectorAll('.remove-region-trigger').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.dataset.id);
      state.regionTriggers = state.regionTriggers.filter(t => t.id !== id);
      renderRegionTriggerList();
    });
  });
}

// Region change detection during recording — compare screenshots at intervals
function startRegionChangeDetection() {
  if (!state.regionTriggersEnabled || state.regionTriggers.length === 0) return;
  state.regionBaselines = {};

  // Capture baseline for each region
  captureRegionBaselines();

  // Check every 3 seconds
  state.regionCheckInterval = setInterval(async () => {
    if (state.recordingStatus !== 'recording' || !state.regionTriggersEnabled) {
      stopRegionChangeDetection();
      return;
    }
    await checkRegionChanges();
  }, 3000);
}

function stopRegionChangeDetection() {
  if (state.regionCheckInterval) {
    clearInterval(state.regionCheckInterval);
    state.regionCheckInterval = null;
  }
  state.regionBaselines = {};
}

async function captureRegionBaselines() {
  try {
    const result = await window.api.capture.screenshot();
    if (!result.success || !result.path) return;

    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      for (const region of state.regionTriggers) {
        if (!region.enabled) continue;
        const b = region.bounds;
        const rx = Math.round(b.x * canvas.width);
        const ry = Math.round(b.y * canvas.height);
        const rw = Math.round(b.w * canvas.width);
        const rh = Math.round(b.h * canvas.height);
        if (rw > 0 && rh > 0) {
          state.regionBaselines[region.id] = ctx.getImageData(rx, ry, rw, rh);
        }
      }
    };
    img.src = `file://${result.path}`;
  } catch (err) {
    console.error('Region baseline capture failed:', err);
  }
}

async function checkRegionChanges() {
  try {
    const result = await window.api.capture.screenshot();
    if (!result.success || !result.path) return;

    const img = new Image();
    img.onload = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      for (const region of state.regionTriggers) {
        if (!region.enabled) continue;
        const baseline = state.regionBaselines[region.id];
        if (!baseline) continue;

        const b = region.bounds;
        const rx = Math.round(b.x * canvas.width);
        const ry = Math.round(b.y * canvas.height);
        const rw = Math.round(b.w * canvas.width);
        const rh = Math.round(b.h * canvas.height);
        if (rw <= 0 || rh <= 0) continue;

        const current = ctx.getImageData(rx, ry, rw, rh);
        const changePct = computePixelChange(baseline.data, current.data);

        if (changePct > 15) {
          // Significant change detected — mark step boundary
          await executeTriggerAction('new-step');
          showToast(`Region "${region.name}" changed (${changePct.toFixed(0)}%)`, 'info', 2000);
          // Update baseline
          state.regionBaselines[region.id] = current;
        }
      }
    };
    img.src = `file://${result.path}`;
  } catch (err) {
    console.error('Region change check failed:', err);
  }
}

function computePixelChange(data1, data2) {
  if (data1.length !== data2.length) return 0;
  let changed = 0;
  const totalPixels = data1.length / 4;
  for (let i = 0; i < data1.length; i += 4) {
    const dr = Math.abs(data1[i] - data2[i]);
    const dg = Math.abs(data1[i + 1] - data2[i + 1]);
    const db = Math.abs(data1[i + 2] - data2[i + 2]);
    if (dr + dg + db > 75) changed++;  // threshold per pixel
  }
  return (changed / totalPixels) * 100;
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
// Feature: Analytics Summary
// ============================================================
function renderAnalyticsSummary() {
  const card = document.getElementById('analyticsSummaryCard');
  if (!state.steps || state.steps.length === 0) {
    card.classList.add('hidden');
    return;
  }
  card.classList.remove('hidden');

  // Calculate metrics
  const totalLeadTime = state.steps.reduce((sum, s) => sum + (s.duration_secs || 0), 0);
  const totalCycleTime = state.steps.reduce((sum, s) => sum + (s.cycle_time || 0), 0);
  const pce = totalLeadTime > 0 ? ((totalCycleTime / totalLeadTime) * 100) : 0;

  let vaTime = 0, nvaTime = 0;
  state.steps.forEach(s => {
    const dur = s.duration_secs || 0;
    if (s.va_type === 'va') vaTime += dur;
    else if (s.va_type === 'nva') nvaTime += dur;
  });

  document.getElementById('analyticsLeadTime').textContent = formatSeconds(totalLeadTime);
  document.getElementById('analyticsCycleTime').textContent = formatSeconds(totalCycleTime);
  document.getElementById('analyticsPCE').textContent = pce > 0 ? `${pce.toFixed(1)}%` : '--';
  document.getElementById('analyticsVATime').textContent = formatSeconds(vaTime);
  document.getElementById('analyticsNVATime').textContent = formatSeconds(nvaTime);

  // Find bottleneck (longest cycle time step)
  let bottleneckStep = null;
  let maxCycle = 0;
  state.steps.forEach(s => {
    const ct = s.cycle_time || s.duration_secs || 0;
    if (ct > maxCycle) {
      maxCycle = ct;
      bottleneckStep = s;
    }
  });

  const bottleneckEl = document.getElementById('analyticsBottleneck');
  if (bottleneckStep && maxCycle > 0) {
    bottleneckEl.classList.remove('hidden');
    document.getElementById('analyticsBottleneckName').textContent =
      `${bottleneckStep.stage_name || bottleneckStep.window_title || 'Unnamed'} (${formatSeconds(maxCycle)})`;
  } else {
    bottleneckEl.classList.add('hidden');
  }

  // Render bar chart (CSS bars for cycle time per step)
  const chartContainer = document.getElementById('analyticsBarChart');
  const maxBarValue = Math.max(...state.steps.map(s => s.cycle_time || s.duration_secs || 0), 1);

  chartContainer.innerHTML = state.steps.map((step, idx) => {
    const value = step.cycle_time || step.duration_secs || 0;
    const pct = (value / maxBarValue) * 100;
    const isBottleneck = step === bottleneckStep;
    const vaClass = step.va_type || 'undetermined';
    const label = step.stage_name || `Step ${idx + 1}`;

    return `
      <div class="analytics-bar-row ${isBottleneck ? 'bottleneck' : ''}">
        <div class="analytics-bar-label" title="${escapeAttr(label)}">${escapeHtml(label)}</div>
        <div class="analytics-bar-track">
          <div class="analytics-bar-fill ${vaClass}" style="width:${Math.max(pct, 2)}%"></div>
        </div>
        <div class="analytics-bar-value font-mono">${value.toFixed(1)}s</div>
      </div>
    `;
  }).join('');
}

// ============================================================
// Feature: Process Change Flagging
// ============================================================
function showChangeFlagDialog(stepIndex) {
  const step = state.steps[stepIndex];
  const existing = step.change_flag || {};

  // Create a modal overlay
  const overlay = document.createElement('div');
  overlay.className = 'change-flag-overlay';
  overlay.innerHTML = `
    <div class="change-flag-dialog">
      <div class="card-title mb-3">Flag Process Change</div>
      <div class="form-group">
        <label class="form-label">Change Type</label>
        <select class="form-select" id="changeFlagType">
          <option value="">Select type...</option>
          <option value="added" ${existing.type === 'added' ? 'selected' : ''}>Step Added</option>
          <option value="removed" ${existing.type === 'removed' ? 'selected' : ''}>Step Removed</option>
          <option value="modified" ${existing.type === 'modified' ? 'selected' : ''}>Step Modified</option>
          <option value="automated" ${existing.type === 'automated' ? 'selected' : ''}>Now Automated</option>
          <option value="bottleneck" ${existing.type === 'bottleneck' ? 'selected' : ''}>Bottleneck Identified</option>
          <option value="other" ${existing.type === 'other' ? 'selected' : ''}>Other</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Note</label>
        <input type="text" class="form-input" id="changeFlagNote" placeholder="Describe the change..."
          value="${escapeAttr(existing.note || '')}" />
      </div>
      <div class="flex gap-2 justify-between">
        <button class="btn btn-ghost btn-sm" id="changeFlagRemove" ${!step.change_flag ? 'style="visibility:hidden"' : ''}>Remove Flag</button>
        <div class="flex gap-2">
          <button class="btn btn-secondary btn-sm" id="changeFlagCancel">Cancel</button>
          <button class="btn btn-primary btn-sm" id="changeFlagSave">Save</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector('#changeFlagCancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#changeFlagRemove').addEventListener('click', () => {
    delete state.steps[stepIndex].change_flag;
    if (state.recording) state.recording.steps = state.steps;
    renderReviewSteps();
    overlay.remove();
    showToast('Flag removed', 'info');
  });

  overlay.querySelector('#changeFlagSave').addEventListener('click', () => {
    const type = overlay.querySelector('#changeFlagType').value;
    const note = overlay.querySelector('#changeFlagNote').value.trim();

    if (!type) {
      showToast('Please select a change type', 'error');
      return;
    }

    state.steps[stepIndex].change_flag = { type, note, flagged_at: new Date().toISOString() };
    if (state.recording) state.recording.steps = state.steps;
    renderReviewSteps();
    overlay.remove();
    showToast('Change flagged', 'success');
  });

  // Close on overlay click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
}

// ============================================================
// Feature: Soft Delete with Recovery
// ============================================================
function setupDeleteRecordingControls() {
  document.getElementById('deleteRecordingBtn')?.addEventListener('click', deleteCurrentRecording);
}

async function deleteCurrentRecording() {
  if (!state.recording) {
    showToast('No recording to delete', 'error');
    return;
  }

  if (!confirm('Move this recording to the deleted folder? You can restore it from Settings within 30 days.')) {
    return;
  }

  try {
    // If the recording has a file path, use soft delete via IPC
    // Otherwise just clear from memory (it was never saved)
    if (state.recording.sessionPath) {
      const result = await window.api.recording.delete(state.recording.sessionPath);
      if (!result.success) {
        showToast(`Delete failed: ${result.error}`, 'error');
        return;
      }
    }

    state.recording = null;
    state.steps = [];
    refreshReviewTab();
    showToast('Recording moved to deleted', 'success');
  } catch (err) {
    showToast('Failed to delete recording', 'error');
    console.error('Delete recording error:', err);
  }
}

async function loadDeletedRecordings() {
  const container = document.getElementById('deletedRecordingsList');
  if (!container) return;

  try {
    const result = await window.api.recording.listDeleted();
    if (!result.success || !result.data || result.data.length === 0) {
      container.innerHTML = '<div class="text-sm text-muted" style="text-align:center;padding:12px">No deleted recordings</div>';
      return;
    }

    container.innerHTML = result.data.map(session => {
      const deletedDate = session.deletedAt ? new Date(session.deletedAt).toLocaleDateString() : 'Unknown';
      const daysLeft = session.deletedAt
        ? Math.max(0, 30 - Math.floor((Date.now() - new Date(session.deletedAt).getTime()) / (1000 * 60 * 60 * 24)))
        : '?';

      return `
        <div class="deleted-recording-item">
          <div class="deleted-recording-info">
            <div class="text-sm font-semibold">${escapeHtml(session.sessionId)}</div>
            <div class="text-xs text-muted">${session.stepCount} steps | ${session.mode} | Deleted ${deletedDate} | ${daysLeft} days left</div>
          </div>
          <div class="flex gap-2">
            <button class="btn btn-secondary btn-sm" data-action="restore" data-path="${escapeAttr(session.path)}">Restore</button>
            <button class="btn btn-danger btn-sm" data-action="perm-delete" data-path="${escapeAttr(session.path)}">Delete Forever</button>
          </div>
        </div>
      `;
    }).join('');

    // Event delegation
    container.querySelectorAll('[data-action="restore"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const p = btn.dataset.path;
        const result = await window.api.recording.restore(p);
        if (result.success) {
          showToast('Recording restored', 'success');
          loadDeletedRecordings();
        } else {
          showToast(`Restore failed: ${result.error}`, 'error');
        }
      });
    });

    container.querySelectorAll('[data-action="perm-delete"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Permanently delete this recording? This cannot be undone.')) return;
        const p = btn.dataset.path;
        const result = await window.api.recording.permanentDelete(p);
        if (result.success) {
          showToast('Permanently deleted', 'info');
          loadDeletedRecordings();
        } else {
          showToast(`Delete failed: ${result.error}`, 'error');
        }
      });
    });
  } catch (err) {
    console.error('Failed to load deleted recordings:', err);
    container.innerHTML = '<div class="text-sm text-muted" style="text-align:center;padding:12px">Error loading deleted recordings</div>';
  }
}

// ============================================================
// Feature: Notification Bell
// ============================================================
function setupNotificationControls() {
  document.getElementById('notificationBellBtn')?.addEventListener('click', toggleNotificationPanel);
  document.getElementById('closeNotificationsBtn')?.addEventListener('click', () => {
    document.getElementById('notificationPanel').classList.add('hidden');
    state.notificationPanelOpen = false;
  });

  // Close panel on outside click
  document.addEventListener('click', (e) => {
    if (state.notificationPanelOpen && !e.target.closest('.notification-bell-wrapper')) {
      document.getElementById('notificationPanel').classList.add('hidden');
      state.notificationPanelOpen = false;
    }
  });
}

function startNotificationPolling() {
  stopNotificationPolling();
  fetchNotificationCount();
  pollLiveRecording();
  state.notificationPollInterval = setInterval(() => {
    fetchNotificationCount();
    pollLiveRecording();
  }, 10000);
}

function stopNotificationPolling() {
  if (state.notificationPollInterval) {
    clearInterval(state.notificationPollInterval);
    state.notificationPollInterval = null;
  }
}

async function fetchNotificationCount() {
  if (!state.connected) return;
  try {
    const result = await window.api.sync.getNotificationCount();
    state.notificationCount = result.count || 0;
    const badge = document.getElementById('notificationBadge');
    if (state.notificationCount > 0) {
      badge.textContent = state.notificationCount > 99 ? '99+' : state.notificationCount;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  } catch (err) {
    // Silently fail
  }
}

async function toggleNotificationPanel() {
  const panel = document.getElementById('notificationPanel');
  state.notificationPanelOpen = !state.notificationPanelOpen;
  panel.classList.toggle('hidden', !state.notificationPanelOpen);

  if (state.notificationPanelOpen) {
    await loadNotifications();
  }
}

// Live recording smooth timer state
let _liveRecBase = { secs: 0, ts: Date.now(), active: false, visible: false };
let _liveRecTickInterval = null;

async function pollLiveRecording() {
  if (!state.connected) return;
  try {
    const result = await window.api.sync.request('/live-recording/active');
    const banner = document.getElementById('liveRecordingBanner');
    if (!banner) return;
    if (result && result.active && result.source_device !== 'desktop') {
      const device = { watch: 'Apple Watch', mobile: 'Mobile App' }[result.source_device] || 'another device';
      const paused = result.status === 'paused';
      _liveRecBase = { secs: result.elapsed_secs || 0, ts: Date.now(), active: !paused, step: result.current_step || 0, total: result.total_steps || '?' };
      if (!_liveRecBase.visible) {
        banner.innerHTML = `<div class="live-recording-alert ${paused ? 'paused' : ''}">
          <span class="pulse-dot"></span>
          <span class="live-text"><strong>${paused ? 'Paused' : 'Recording'}</strong> — ${result.map_name || 'Untitled'} on ${device}</span>
          <span class="live-timer" id="liveRecTimer"></span>
          <span class="live-step" id="liveRecStep">Step ${_liveRecBase.step}/${_liveRecBase.total}</span>
        </div>`;
        banner.classList.remove('hidden');
        _liveRecBase.visible = true;
        if (!_liveRecTickInterval) {
          _liveRecTickInterval = setInterval(_tickLiveRec, 1000);
        }
      }
      // Update step count on each poll
      const stepEl = document.getElementById('liveRecStep');
      if (stepEl) stepEl.textContent = `Step ${_liveRecBase.step}/${_liveRecBase.total}`;
      _tickLiveRec();
    } else {
      banner.classList.add('hidden');
      _liveRecBase.visible = false;
      if (_liveRecTickInterval) { clearInterval(_liveRecTickInterval); _liveRecTickInterval = null; }
    }
  } catch {
    // Ignore polling errors
  }
}

function _tickLiveRec() {
  const el = document.getElementById('liveRecTimer');
  if (!el) return;
  const b = _liveRecBase;
  const secs = b.active ? b.secs + (Date.now() - b.ts) / 1000 : b.secs;
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  el.textContent = m + ':' + String(s).padStart(2, '0');
}

async function loadNotifications() {
  const listEl = document.getElementById('notificationList');
  listEl.innerHTML = '<div class="text-sm text-muted" style="padding:20px;text-align:center">Loading...</div>';

  try {
    const result = await window.api.sync.getNotifications();
    const notifications = result.data || [];

    if (notifications.length === 0) {
      listEl.innerHTML = '<div class="text-sm text-muted" style="padding:20px;text-align:center">No notifications</div>';
      return;
    }

    listEl.innerHTML = notifications.slice(0, 20).map(n => `
      <div class="notification-item ${n.read ? '' : 'unread'}">
        <div class="notification-item-title">${escapeHtml(n.title || 'Notification')}</div>
        <div class="notification-item-message">${escapeHtml(n.message || '')}</div>
        <div class="notification-item-time text-xs text-muted">${n.created_at ? new Date(n.created_at).toLocaleString() : ''}</div>
      </div>
    `).join('');
  } catch (err) {
    listEl.innerHTML = '<div class="text-sm text-muted" style="padding:20px;text-align:center">Failed to load notifications</div>';
  }
}

// ============================================================
// Feature: Quick Stats in Header
// ============================================================
async function fetchQuickStats() {
  if (!state.connected) return;
  try {
    const result = await window.api.sync.getStats();
    if (result.success && result.data) {
      state.quickStats = result.data;
      const statsEl = document.getElementById('headerQuickStats');
      document.getElementById('headerMapCount').textContent = result.data.total_maps || 0;
      statsEl.classList.remove('hidden');
    }
  } catch (err) {
    // Silently fail
  }
}

// ============================================================
// Quick Simulate
// ============================================================
function setupQuickSimulate() {
  document.getElementById('runQuickSimBtn').addEventListener('click', runQuickSimulation);
}

function runQuickSimulation() {
  if (!state.steps || state.steps.length === 0) return;

  const card = document.getElementById('quickSimulateCard');
  const panel = document.getElementById('simResultsPanel');

  if (typeof window.simulateProcess !== 'function') {
    showToast('Simulation engine not loaded', 'error');
    return;
  }

  const result = window.simulateProcess(state.steps, {
    numSimulations: 100,
    variationPct: 15,
  });

  // Populate results
  document.getElementById('simLeadTime').textContent = formatSeconds(result.leadTime.mean);
  document.getElementById('simLeadTimeRange').textContent =
    `P10: ${formatSeconds(result.leadTime.p10)} / P90: ${formatSeconds(result.leadTime.p90)}`;

  document.getElementById('simPCE').textContent = result.pce.mean > 0 ? `${result.pce.mean}%` : '--';
  document.getElementById('simPCERange').textContent =
    `P10: ${result.pce.p10}% / P90: ${result.pce.p90}%`;

  document.getElementById('simWIP').textContent = result.wip.mean;
  document.getElementById('simWIPRange').textContent =
    `P10: ${result.wip.p10} / P90: ${result.wip.p90}`;

  document.getElementById('simConfP10').textContent = formatSeconds(result.leadTime.p10);
  document.getElementById('simConfP90').textContent = formatSeconds(result.leadTime.p90);
  document.getElementById('simRunCount').textContent = `(${result.runs} runs)`;

  // Top bottleneck
  const bnEntries = Object.entries(result.bottleneckFrequency);
  if (bnEntries.length > 0) {
    const topBn = bnEntries[0];
    document.getElementById('simBottleneck').textContent = topBn[0];
    document.getElementById('simBottleneckPct').textContent =
      `Bottleneck in ${Math.round(topBn[1] / result.runs * 100)}% of runs`;
  }

  // Bottleneck frequency chart (CSS bars)
  const chartContainer = document.getElementById('simBottleneckChart');
  const maxBn = Math.max(...bnEntries.map(e => e[1]), 1);
  chartContainer.innerHTML = bnEntries.map(([name, count]) => {
    const pct = (count / result.runs) * 100;
    const isTop = name === bnEntries[0][0];
    return `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <span style="width:120px;font-size:11px;color:var(--vs-text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(name)}</span>
        <div style="flex:1;height:6px;background:var(--vs-surface-alt);border-radius:3px;overflow:hidden">
          <div style="height:100%;width:${pct}%;border-radius:3px;background:${isTop ? 'var(--vs-danger, #ef4444)' : 'var(--vs-primary)'}"></div>
        </div>
        <span style="width:36px;font-size:10px;font-family:monospace;color:var(--vs-text-muted);text-align:right">${Math.round(pct)}%</span>
      </div>
    `;
  }).join('');

  panel.classList.remove('hidden');
  showToast('Simulation complete', 'success');
}

// Show/hide quick simulate card when review tab loads
function updateQuickSimulateVisibility() {
  const card = document.getElementById('quickSimulateCard');
  if (state.steps && state.steps.length > 0) {
    card.classList.remove('hidden');
  } else {
    card.classList.add('hidden');
  }
}

// ============================================================
// Feature: Run History in Review Tab
// ============================================================
function setupRunHistoryControls() {
  const selector = document.getElementById('runHistoryMapSelector');
  if (selector) {
    selector.addEventListener('change', (e) => {
      const mapId = e.target.value;
      if (mapId) {
        loadRunHistory(mapId);
      } else {
        document.getElementById('runHistoryList').innerHTML =
          '<div class="text-sm text-muted" style="padding:12px;text-align:center">Select a map to view runs</div>';
        document.getElementById('runStageDetails')?.classList.add('hidden');
        document.getElementById('trendChartContainer')?.classList.add('hidden');
        state.runsHistory = [];
      }
    });
  }
}
async function loadRunHistory(mapId) {
  if (!state.connected || !mapId) return;
  state.selectedRunMapId = mapId;

  const container = document.getElementById('runHistoryList');
  if (!container) return;

  container.innerHTML = '<div class="text-sm text-muted" style="padding:12px;text-align:center">Loading runs...</div>';

  try {
    const result = await window.api.sync.getMapRuns(mapId);
    if (result.success && Array.isArray(result.data)) {
      state.runsHistory = result.data;
      renderRunHistory();
      renderTrendChart();
    } else {
      container.innerHTML = '<div class="text-sm text-muted" style="padding:12px;text-align:center">No runs found</div>';
      state.runsHistory = [];
    }
  } catch (err) {
    container.innerHTML = '<div class="text-sm text-muted" style="padding:12px;text-align:center">Failed to load runs</div>';
    console.error('Failed to load run history:', err);
  }
}

function renderRunHistory() {
  const container = document.getElementById('runHistoryList');
  if (!container) return;

  if (!state.runsHistory || state.runsHistory.length === 0) {
    container.innerHTML = '<div class="text-sm text-muted" style="padding:12px;text-align:center">No runs recorded yet</div>';
    return;
  }

  container.innerHTML = state.runsHistory.map(run => {
    const date = run.created_at ? new Date(run.created_at).toLocaleDateString() : '--';
    const time = run.created_at ? new Date(run.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    const statusClass = run.status === 'completed' ? 'run-completed' : run.status === 'in_progress' ? 'run-active' : 'run-draft';
    const statusLabel = run.status === 'completed' ? 'Completed' : run.status === 'in_progress' ? 'In Progress' : run.status || 'Draft';
    const pce = run.pce !== undefined && run.pce !== null ? `${Number(run.pce).toFixed(1)}%` : '--';
    const leadTime = run.lead_time_secs ? formatSeconds(run.lead_time_secs) : '--';

    return `
      <div class="run-history-item" data-run-id="${run.id || ''}" data-run-number="${run.run_number || ''}">
        <div class="run-history-header">
          <span class="run-number-badge">Run #${run.run_number || '?'}</span>
          <span class="run-status-badge ${statusClass}">${statusLabel}</span>
        </div>
        <div class="run-history-details">
          <span class="run-detail"><strong>Date:</strong> ${date} ${time}</span>
          <span class="run-detail"><strong>Lead:</strong> ${leadTime}</span>
          <span class="run-detail"><strong>PCE:</strong> ${pce}</span>
          ${run.stages_count ? `<span class="run-detail"><strong>Stages:</strong> ${run.stages_count}</span>` : ''}
        </div>
      </div>
    `;
  }).join('');

  // Click handler to load run stage details
  container.querySelectorAll('.run-history-item').forEach(item => {
    item.addEventListener('click', () => {
      const runId = item.dataset.runId;
      if (runId) loadRunDetails(runId);
      // Highlight selected
      container.querySelectorAll('.run-history-item').forEach(i => i.classList.remove('selected'));
      item.classList.add('selected');
    });
  });
}

async function loadRunDetails(runId) {
  if (!state.connected || !state.selectedRunMapId) return;

  try {
    const result = await window.api.sync.request(`/maps/${state.selectedRunMapId}/runs/${runId}`);
    if (result && result.stages) {
      renderRunStageDetails(result);
    }
  } catch (err) {
    console.error('Failed to load run details:', err);
  }
}

function renderRunStageDetails(run) {
  const container = document.getElementById('runStageDetails');
  if (!container) return;

  const stages = run.stages || [];
  if (stages.length === 0) {
    container.innerHTML = '<div class="text-sm text-muted" style="padding:8px;text-align:center">No stage data</div>';
    container.classList.remove('hidden');
    return;
  }

  const maxDuration = Math.max(...stages.map(s => s.duration_secs || s.cycle_time || 0), 1);

  container.innerHTML = `
    <div class="text-xs text-muted font-semibold mb-2" style="text-transform:uppercase;letter-spacing:0.5px">
      Run #${run.run_number || '?'} Stage Timing
    </div>
    ${stages.map(stage => {
      const value = stage.duration_secs || stage.cycle_time || 0;
      const pct = (value / maxDuration) * 100;
      const vaClass = stage.va_type || 'undetermined';
      return `
        <div class="analytics-bar-row">
          <div class="analytics-bar-label" title="${escapeAttr(stage.stage_name || stage.name || '')}">${escapeHtml(stage.stage_name || stage.name || 'Unnamed')}</div>
          <div class="analytics-bar-track">
            <div class="analytics-bar-fill ${vaClass}" style="width:${Math.max(pct, 2)}%"></div>
          </div>
          <div class="analytics-bar-value font-mono">${value.toFixed(1)}s</div>
        </div>
      `;
    }).join('')}
  `;
  container.classList.remove('hidden');
}

// ============================================================
// Feature: Lead Time Trend Chart
// ============================================================
function renderTrendChart() {
  const container = document.getElementById('trendChartContainer');
  if (!container) return;

  if (!state.runsHistory || state.runsHistory.length < 2) {
    container.classList.add('hidden');
    return;
  }

  container.classList.remove('hidden');

  // Filter to runs with lead time data
  const runsWithData = state.runsHistory
    .filter(r => r.lead_time_secs && r.lead_time_secs > 0)
    .sort((a, b) => (a.run_number || 0) - (b.run_number || 0));

  if (runsWithData.length < 2) {
    container.innerHTML = '<div class="card"><div class="card-title mb-3">Lead Time Trend</div><div class="text-sm text-muted">Need at least 2 runs with timing data for trends.</div></div>';
    return;
  }

  const maxLead = Math.max(...runsWithData.map(r => r.lead_time_secs));
  const minLead = Math.min(...runsWithData.map(r => r.lead_time_secs));
  const avgLead = runsWithData.reduce((s, r) => s + r.lead_time_secs, 0) / runsWithData.length;
  const barMaxHeight = 80; // px

  // Determine trend direction
  const first = runsWithData[0].lead_time_secs;
  const last = runsWithData[runsWithData.length - 1].lead_time_secs;
  const trendPct = first > 0 ? ((last - first) / first * 100) : 0;
  const trendDir = trendPct < -2 ? 'improving' : trendPct > 2 ? 'regressing' : 'stable';
  const trendLabel = trendDir === 'improving'
    ? `Improving (${Math.abs(trendPct).toFixed(0)}% faster)`
    : trendDir === 'regressing'
      ? `Regressing (${trendPct.toFixed(0)}% slower)`
      : 'Stable';
  const trendColor = trendDir === 'improving' ? 'var(--vs-success, #22c55e)' : trendDir === 'regressing' ? 'var(--vs-danger, #ef4444)' : 'var(--vs-text-muted)';

  container.innerHTML = `
    <div class="card">
      <div class="flex items-center justify-between mb-3">
        <div class="card-title">Lead Time Trend</div>
        <span style="font-size:12px;font-weight:600;color:${trendColor}">${trendLabel}</span>
      </div>
      <div style="display:flex;align-items:flex-end;gap:4px;height:${barMaxHeight + 20}px;padding-bottom:20px;position:relative">
        ${runsWithData.map(run => {
          const height = maxLead > 0 ? Math.max((run.lead_time_secs / maxLead) * barMaxHeight, 4) : 4;
          const isLast = run === runsWithData[runsWithData.length - 1];
          const pce = run.pce !== undefined && run.pce !== null ? `PCE: ${Number(run.pce).toFixed(0)}%` : '';
          return `
            <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px" title="Run #${run.run_number}: ${formatSeconds(run.lead_time_secs)} ${pce}">
              <span style="font-size:9px;color:var(--vs-text-muted);font-family:monospace">${formatSeconds(run.lead_time_secs)}</span>
              <div style="width:100%;max-width:40px;height:${height}px;border-radius:4px 4px 0 0;background:${isLast ? 'var(--vs-primary)' : 'var(--vs-primary-light, rgba(99,102,241,0.4))'};transition:height 0.3s"></div>
              <span style="font-size:9px;color:var(--vs-text-muted);position:absolute;bottom:0">#${run.run_number}</span>
            </div>
          `;
        }).join('')}
      </div>
      <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--vs-text-muted);margin-top:4px;border-top:1px solid var(--vs-border);padding-top:6px">
        <span>Avg: ${formatSeconds(avgLead)}</span>
        <span>Best: ${formatSeconds(minLead)}</span>
        <span>Worst: ${formatSeconds(maxLead)}</span>
      </div>
    </div>
  `;
}

// ============================================================
// Feature: Auto-Sync on Recording Complete
// ============================================================
function startAutoSync() {
  stopAutoSync();
  const isEnabled = document.getElementById('settingsAutoSync')?.classList.contains('active');
  if (!isEnabled || !state.connected) return;

  const freq = parseInt(document.getElementById('settingsSyncFrequency')?.value || '0');
  if (freq <= 0) return;

  state.autoSyncInterval = setInterval(async () => {
    if (!state.connected || !state.recording || !state.steps.length) return;
    // Only auto-sync if there's a recording and a default map selected
    const mapId = document.getElementById('mapSelector')?.value;
    if (!mapId || mapId === '' || mapId === '_new') return;

    try {
      const result = await window.api.sync.upload({ mapId, recording: state.recording });
      if (result.success) {
        const runNum = result.data?.run_number;
        showToast(runNum ? `Auto-synced as Run #${runNum}` : 'Auto-synced to MapVS', 'success');
      }
    } catch (err) {
      console.error('Auto-sync failed:', err);
    }
  }, freq);
}

function stopAutoSync() {
  if (state.autoSyncInterval) {
    clearInterval(state.autoSyncInterval);
    state.autoSyncInterval = null;
  }
}

// Wire auto-sync when recording completes
function onRecordingComplete() {
  const isAutoSync = document.getElementById('settingsAutoSync')?.classList.contains('active');
  if (!isAutoSync || !state.connected || !state.recording || !state.steps.length) return;

  const mapId = document.getElementById('mapSelector')?.value;
  if (!mapId || mapId === '' || mapId === '_new') return;

  // Auto-upload on completion
  (async () => {
    try {
      const result = await window.api.sync.upload({ mapId, recording: state.recording });
      if (result.success) {
        const runNum = result.data?.run_number;
        showToast(runNum ? `Auto-synced as Run #${runNum}` : 'Auto-synced to MapVS', 'success');
      }
    } catch (err) {
      console.error('Auto-sync on complete failed:', err);
    }
  })();
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

// ============================================================
// Annotate Tab — Video Annotation for Value Stream Mapping
// ============================================================
const annotateState = {
  videoLoaded: false,
  stages: [],         // { id, name, startTime, endTime, va: true, merged: false }
  currentVa: true,
  currentSpeed: 1,
  cycleMode: false,
  pendingStartTime: null,
  linkedMapId: null,
  stageIdCounter: 0,
  // Pose analysis state
  poseData: null,          // { frames: [...], summary: {...} } from API
  poseVideoId: null,       // video ID on server
  poseVideoFilePath: null, // local file path of loaded video
  poseLayers: { skeleton: true, angles: false, zones: false, trails: false },
  poseAnalysisRunning: false,
};

function setupAnnotateTab() {
  const video = document.getElementById('annotateVideo');
  if (!video) return;

  // Open Video
  document.getElementById('annotateOpenVideoBtn')?.addEventListener('click', openVideoFile);
  document.getElementById('annotateUseLastBtn')?.addEventListener('click', useLastRecording);

  // Play/Pause
  document.getElementById('annotatePlayBtn')?.addEventListener('click', annotateTogglePlay);

  // Mark Start / End
  document.getElementById('annotateMarkStartBtn')?.addEventListener('click', annotateMarkStart);
  document.getElementById('annotateMarkEndBtn')?.addEventListener('click', annotateMarkEnd);

  // VA/NVA Toggle
  document.getElementById('annotateVaToggle')?.addEventListener('click', annotateToggleVaNva);

  // Cycle Mode
  document.getElementById('annotateCycleMode')?.addEventListener('change', (e) => {
    annotateState.cycleMode = e.target.checked;
  });

  // Speed buttons
  document.querySelectorAll('.annotate-speed-btn').forEach(btn => {
    btn.addEventListener('click', () => annotateSetSpeed(parseFloat(btn.dataset.speed)));
  });

  // Link to Map dropdown
  document.getElementById('annotateLinkMap')?.addEventListener('change', (e) => {
    annotateState.linkedMapId = e.target.value || null;
    const saveRunBtn = document.getElementById('annotateSaveRunBtn');
    if (saveRunBtn) saveRunBtn.disabled = !annotateState.linkedMapId || annotateState.stages.length === 0;
  });

  // Save / Export
  document.getElementById('annotateSaveMapBtn')?.addEventListener('click', annotateSaveAsMap);
  document.getElementById('annotateSaveRunBtn')?.addEventListener('click', annotateSaveAsRun);
  document.getElementById('annotateExportCsvBtn')?.addEventListener('click', annotateExportCsv);

  // Pose Analysis
  document.getElementById('annotatePoseAnalysisBtn')?.addEventListener('click', runPoseAnalysis);
  document.querySelectorAll('.pose-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const layer = btn.dataset.layer;
      annotateState.poseLayers[layer] = !annotateState.poseLayers[layer];
      btn.classList.toggle('active', annotateState.poseLayers[layer]);
      renderPoseOverlay();
    });
  });

  // Video time update
  video.addEventListener('timeupdate', annotateOnTimeUpdate);
  video.addEventListener('ended', () => {
    if (annotateState.cycleMode) {
      video.currentTime = 0;
      video.play();
    } else {
      updateAnnotatePlayIcon(false);
    }
  });

  // Timeline click to seek
  document.getElementById('annotateTimeline')?.addEventListener('click', (e) => {
    if (!video.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    video.currentTime = pct * video.duration;
  });

  // Keyboard shortcuts (only when annotate tab is active)
  document.addEventListener('keydown', annotateKeyHandler);
}

function annotateKeyHandler(e) {
  if (state.activeTab !== 'annotate') return;
  // Ignore if typing in input/select
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

  const video = document.getElementById('annotateVideo');
  if (!video) return;

  switch (e.key) {
    case ' ':
      e.preventDefault();
      annotateTogglePlay();
      break;
    case 's':
    case 'S':
      if (!e.ctrlKey && !e.metaKey) { e.preventDefault(); annotateMarkStart(); }
      break;
    case 'e':
    case 'E':
      e.preventDefault();
      annotateMarkEnd();
      break;
    case 'v':
    case 'V':
      e.preventDefault();
      annotateToggleVaNva();
      break;
    case 'n':
    case 'N':
      e.preventDefault();
      annotateMarkStart();
      break;
    case 'd':
    case 'D':
      e.preventDefault();
      annotateDeleteLastStage();
      break;
    case 'ArrowLeft':
      e.preventDefault();
      annotateStepFrame(e.shiftKey ? -30 : -1, video);
      break;
    case 'ArrowRight':
      e.preventDefault();
      annotateStepFrame(e.shiftKey ? 30 : 1, video);
      break;
    case '1': annotateSetSpeed(0.25); break;
    case '2': annotateSetSpeed(0.5); break;
    case '3': annotateSetSpeed(1); break;
    case '4': annotateSetSpeed(1.5); break;
    case '5': annotateSetSpeed(2); break;
  }
}

async function openVideoFile() {
  try {
    const filePath = await window.api.dialog.openVideo();
    if (filePath) loadVideoForAnnotation(filePath);
  } catch (err) {
    showToast('Failed to open video: ' + err.message, 'error');
  }
}

function loadVideoForAnnotation(filePath) {
  const video = document.getElementById('annotateVideo');
  const placeholder = document.getElementById('annotateVideoPlaceholder');
  if (!video) return;

  // Use file:// protocol for local files
  const src = filePath.startsWith('file://') ? filePath : 'file://' + filePath;
  video.src = src;
  video.style.display = 'block';
  if (placeholder) placeholder.style.display = 'none';
  annotateState.videoLoaded = true;

  // Store the raw file path for pose analysis upload
  annotateState.poseVideoFilePath = filePath.replace(/^file:\/\//, '');
  annotateState.poseData = null;
  annotateState.poseVideoId = null;
  hidePoseOverlay();

  // Enable pose analysis button
  const poseBtn = document.getElementById('annotatePoseAnalysisBtn');
  if (poseBtn) poseBtn.disabled = false;

  // Reset stages
  annotateState.stages = [];
  annotateState.pendingStartTime = null;
  annotateState.stageIdCounter = 0;
  renderAnnotateStages();
  updateAnnotateButtons();

  video.addEventListener('loadedmetadata', () => {
    annotateOnTimeUpdate();
    showToast('Video loaded: ' + formatAnnotateTime(video.duration), 'success');
  }, { once: true });
}

async function useLastRecording() {
  try {
    const result = await window.api.recording.getLastSessionPath();
    if (!result || !result.session) {
      showToast('No recordings found', 'warning');
      return;
    }
    // Look for video files in the session's storage directory
    const session = result.session;
    if (session.videoPath) {
      loadVideoForAnnotation(session.videoPath);
    } else if (session.steps && session.steps.length > 0 && session.steps[0].screenshotPath) {
      // No video — load as screenshot-based annotation
      showToast('Last recording is screenshot-based. Open a video file instead.', 'warning');
    } else {
      showToast('No video found in last recording session', 'warning');
    }
  } catch (err) {
    showToast('Failed to load last recording: ' + err.message, 'error');
  }
}

function annotateTogglePlay() {
  const video = document.getElementById('annotateVideo');
  if (!video || !annotateState.videoLoaded) return;
  if (video.paused) {
    video.play();
    updateAnnotatePlayIcon(true);
  } else {
    video.pause();
    updateAnnotatePlayIcon(false);
  }
}

function updateAnnotatePlayIcon(playing) {
  const icon = document.getElementById('annotatePlayIcon');
  if (!icon) return;
  if (playing) {
    icon.innerHTML = '<rect x="6" y="4" width="4" height="16" fill="currentColor"/><rect x="14" y="4" width="4" height="16" fill="currentColor"/>';
  } else {
    icon.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"/>';
  }
}

function annotateStepFrame(frames, video) {
  if (!video) video = document.getElementById('annotateVideo');
  if (!video || !annotateState.videoLoaded) return;
  video.pause();
  updateAnnotatePlayIcon(false);
  // Assume 30fps
  video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + (frames / 30)));
}

function annotateSetSpeed(speed) {
  const video = document.getElementById('annotateVideo');
  if (video) video.playbackRate = speed;
  annotateState.currentSpeed = speed;
  document.querySelectorAll('.annotate-speed-btn').forEach(btn => {
    btn.classList.toggle('active', parseFloat(btn.dataset.speed) === speed);
  });
}

function annotateMarkStart() {
  const video = document.getElementById('annotateVideo');
  if (!video || !annotateState.videoLoaded) return;
  annotateState.pendingStartTime = video.currentTime;
  showToast('Start marked at ' + formatAnnotateTime(video.currentTime), 'info');
}

function annotateMarkEnd() {
  const video = document.getElementById('annotateVideo');
  if (!video || !annotateState.videoLoaded) return;
  const endTime = video.currentTime;

  if (annotateState.pendingStartTime === null) {
    showToast('Mark a start time first (press S)', 'warning');
    return;
  }

  if (endTime <= annotateState.pendingStartTime) {
    showToast('End time must be after start time', 'warning');
    return;
  }

  const stageNum = annotateState.stages.length + 1;
  annotateState.stages.push({
    id: ++annotateState.stageIdCounter,
    name: 'Stage ' + stageNum,
    startTime: annotateState.pendingStartTime,
    endTime: endTime,
    va: annotateState.currentVa,
    merged: false,
  });

  annotateState.pendingStartTime = null;
  renderAnnotateStages();
  updateAnnotateButtons();
  showToast('Stage ' + stageNum + ' added (' + formatAnnotateTime(annotateState.stages[stageNum - 1].startTime) + ' - ' + formatAnnotateTime(endTime) + ')', 'success');
}

function annotateToggleVaNva() {
  annotateState.currentVa = !annotateState.currentVa;
  const label = document.getElementById('annotateVaLabel');
  const toggle = document.getElementById('annotateVaToggle');
  if (label) label.textContent = annotateState.currentVa ? 'VA' : 'NVA';
  if (toggle) {
    toggle.style.background = annotateState.currentVa ? 'var(--vs-va)' : 'var(--vs-nva)';
    toggle.style.color = '#fff';
  }
}

function annotateDeleteLastStage() {
  if (annotateState.stages.length === 0) return;
  annotateState.stages.pop();
  renderAnnotateStages();
  updateAnnotateButtons();
  showToast('Last stage removed', 'info');
}

function renderAnnotateStages() {
  const list = document.getElementById('annotateStageList');
  const countEl = document.getElementById('annotateStageCount');
  if (!list) return;

  if (countEl) countEl.textContent = annotateState.stages.length + ' stage' + (annotateState.stages.length !== 1 ? 's' : '');

  if (annotateState.stages.length === 0) {
    list.innerHTML = '<div class="annotate-stage-empty text-sm text-muted">Mark stages using the controls below.<br><kbd>S</kbd> = start, <kbd>E</kbd> = end, <kbd>N</kbd> = new stage</div>';
    renderAnnotateTimeline();
    return;
  }

  list.innerHTML = annotateState.stages.map((s, i) => `
    <div class="annotate-stage-item" data-id="${s.id}">
      <div class="annotate-stage-item-header">
        <input type="text" class="annotate-stage-name" value="${escapeAttr(s.name)}" data-idx="${i}" />
        <span class="annotate-stage-badge ${s.va ? 'va' : 'nva'}" data-idx="${i}" title="Click to toggle">${s.va ? 'VA' : 'NVA'}</span>
        <button class="btn btn-ghost btn-xs annotate-stage-delete" data-idx="${i}" title="Delete">&times;</button>
      </div>
      <div class="annotate-stage-times text-xs text-muted">
        ${formatAnnotateTime(s.startTime)} &mdash; ${formatAnnotateTime(s.endTime)}
        <span style="margin-left:8px">${formatAnnotateTime(s.endTime - s.startTime)}</span>
      </div>
    </div>
  `).join('');

  // Bind events
  list.querySelectorAll('.annotate-stage-name').forEach(input => {
    input.addEventListener('change', (e) => {
      const idx = parseInt(e.target.dataset.idx);
      if (annotateState.stages[idx]) annotateState.stages[idx].name = e.target.value;
    });
  });
  list.querySelectorAll('.annotate-stage-badge').forEach(badge => {
    badge.addEventListener('click', (e) => {
      const idx = parseInt(e.target.dataset.idx);
      if (annotateState.stages[idx]) {
        annotateState.stages[idx].va = !annotateState.stages[idx].va;
        renderAnnotateStages();
      }
    });
  });
  list.querySelectorAll('.annotate-stage-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.target.dataset.idx);
      annotateState.stages.splice(idx, 1);
      renderAnnotateStages();
      updateAnnotateButtons();
    });
  });

  renderAnnotateTimeline();
}

function renderAnnotateTimeline() {
  const container = document.getElementById('annotateTimelineSegments');
  const video = document.getElementById('annotateVideo');
  if (!container || !video || !video.duration) { if (container) container.innerHTML = ''; return; }

  const dur = video.duration;
  container.innerHTML = annotateState.stages.map(s => {
    const left = (s.startTime / dur * 100).toFixed(2);
    const width = ((s.endTime - s.startTime) / dur * 100).toFixed(2);
    const color = s.va ? 'var(--vs-va)' : 'var(--vs-nva)';
    return `<div class="annotate-timeline-seg" style="left:${left}%;width:${width}%;background:${color}" title="${escapeAttr(s.name)}"></div>`;
  }).join('');
}

function annotateOnTimeUpdate() {
  const video = document.getElementById('annotateVideo');
  if (!video) return;
  const ts = document.getElementById('annotateTimestamp');
  const fn = document.getElementById('annotateFrameNum');
  const cursor = document.getElementById('annotateTimelineCursor');
  if (ts) ts.textContent = formatAnnotateTime(video.currentTime);
  if (fn) fn.textContent = 'F' + Math.floor(video.currentTime * 30);
  if (cursor && video.duration) {
    cursor.style.left = (video.currentTime / video.duration * 100) + '%';
  }
  // Update pose overlay if pose data is loaded
  if (annotateState.poseData) {
    renderPoseOverlay();
    renderPoseTimeline();
  }
}

function updateAnnotateButtons() {
  const hasStages = annotateState.stages.length > 0;
  const exportBtn = document.getElementById('annotateExportCsvBtn');
  const saveRunBtn = document.getElementById('annotateSaveRunBtn');
  if (exportBtn) exportBtn.disabled = !hasStages;
  if (saveRunBtn) saveRunBtn.disabled = !hasStages || !annotateState.linkedMapId;
}

async function refreshAnnotateMapDropdown() {
  const select = document.getElementById('annotateLinkMap');
  if (!select) return;
  try {
    const result = await window.api.sync.getMaps();
    if (result.success && result.data) {
      const current = select.value;
      select.innerHTML = '<option value="">-- Link to Map --</option>' +
        result.data.map(m => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('');
      if (current) select.value = current;
    }
  } catch {}
}

function buildAnnotateRecording() {
  const totalStart = annotateState.stages.length > 0 ? annotateState.stages[0].startTime : 0;
  const totalEnd = annotateState.stages.length > 0 ? annotateState.stages[annotateState.stages.length - 1].endTime : 0;
  return {
    mode: 'video-annotation',
    startTime: new Date(Date.now() - (totalEnd - totalStart) * 1000).toISOString(),
    endTime: new Date().toISOString(),
    steps: annotateState.stages.map((s, i) => ({
      stepNumber: i + 1,
      notes: s.name,
      timestamp: new Date(Date.now() - (totalEnd - s.startTime) * 1000).toISOString(),
      endTimestamp: new Date(Date.now() - (totalEnd - s.endTime) * 1000).toISOString(),
      duration: Math.round((s.endTime - s.startTime) * 1000),
      va: s.va,
      resource: '',
      attachments: [],
    })),
  };
}

async function annotateSaveAsMap() {
  if (annotateState.stages.length === 0) { showToast('Add at least one stage first', 'warning'); return; }
  const name = prompt('Enter map name:');
  if (!name) return;
  try {
    const recording = buildAnnotateRecording();
    const result = await window.api.sync.createMap({ name, recording });
    if (result.success) {
      showToast('Map "' + name + '" created successfully', 'success');
    } else {
      showToast('Failed: ' + (result.error || 'Unknown error'), 'error');
    }
  } catch (err) {
    showToast('Error creating map: ' + err.message, 'error');
  }
}

async function annotateSaveAsRun() {
  if (annotateState.stages.length === 0 || !annotateState.linkedMapId) return;
  try {
    const recording = buildAnnotateRecording();
    const result = await window.api.sync.upload({ mapId: annotateState.linkedMapId, recording });
    if (result.success) {
      showToast('Run saved to map', 'success');
    } else {
      showToast('Failed: ' + (result.error || 'Unknown error'), 'error');
    }
  } catch (err) {
    showToast('Error saving run: ' + err.message, 'error');
  }
}

function annotateExportCsv() {
  if (annotateState.stages.length === 0) return;
  const rows = [['Stage', 'Name', 'Start (s)', 'End (s)', 'Duration (s)', 'VA/NVA'].join(',')];
  annotateState.stages.forEach((s, i) => {
    rows.push([
      i + 1,
      '"' + s.name.replace(/"/g, '""') + '"',
      s.startTime.toFixed(3),
      s.endTime.toFixed(3),
      (s.endTime - s.startTime).toFixed(3),
      s.va ? 'VA' : 'NVA'
    ].join(','));
  });

  // Total row
  const totalDur = annotateState.stages.reduce((sum, s) => sum + (s.endTime - s.startTime), 0);
  const vaDur = annotateState.stages.filter(s => s.va).reduce((sum, s) => sum + (s.endTime - s.startTime), 0);
  rows.push('');
  rows.push(['', 'Total', '', '', totalDur.toFixed(3), ''].join(','));
  rows.push(['', 'VA Total', '', '', vaDur.toFixed(3), ''].join(','));
  rows.push(['', 'NVA Total', '', '', (totalDur - vaDur).toFixed(3), ''].join(','));
  rows.push(['', 'PCE', '', '', ((vaDur / totalDur) * 100).toFixed(1) + '%', ''].join(','));

  const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'annotation_export_' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
  URL.revokeObjectURL(url);
  showToast('CSV exported', 'success');
}

function formatAnnotateTime(seconds) {
  if (seconds == null || isNaN(seconds)) return '00:00.000';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return String(mins).padStart(2, '0') + ':' + secs.toFixed(3).padStart(6, '0');
}

// ═══════════════════════════════════════════════════════════════════════════
// POSE ANALYSIS — skeleton overlay, ergonomic timeline, risk indicators
// ═══════════════════════════════════════════════════════════════════════════

const POSE_CONNECTIONS = [
  [11,12],[11,13],[13,15],[12,14],[14,16], // arms
  [11,23],[12,24],[23,24],[23,25],[24,26],[25,27],[26,28], // torso + legs
];

const POSE_RISK_COLORS = {
  low:       { bg: '#ECFDF5', fg: '#059669', label: 'Low Risk' },
  medium:    { bg: '#FFF7ED', fg: '#D97706', label: 'Medium Risk' },
  high:      { bg: '#FEF2F2', fg: '#DC2626', label: 'High Risk' },
  very_high: { bg: '#FDF2F8', fg: '#BE185D', label: 'Very High Risk' },
};

function getRiskLevel(score) {
  if (score == null) return 'low';
  if (score <= 3) return 'low';
  if (score <= 5) return 'medium';
  if (score <= 7) return 'high';
  return 'very_high';
}

function getRiskColor(level) {
  return POSE_RISK_COLORS[level] || POSE_RISK_COLORS.low;
}

async function runPoseAnalysis() {
  if (annotateState.poseAnalysisRunning) return;
  if (!annotateState.videoLoaded || !annotateState.poseVideoFilePath) {
    showToast('Load a video first', 'warning');
    return;
  }

  const btn = document.getElementById('annotatePoseAnalysisBtn');
  annotateState.poseAnalysisRunning = true;
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Uploading...';
  }

  try {
    // Step 1: Upload the video file if we don't have a server-side ID yet
    if (!annotateState.poseVideoId) {
      showToast('Uploading video for analysis...', 'info');
      const uploadResult = await window.api.sync.uploadVideoFile(annotateState.poseVideoFilePath);
      if (!uploadResult.success) throw new Error(uploadResult.error || 'Upload failed');
      annotateState.poseVideoId = uploadResult.data.id || uploadResult.data.video_id;
      if (!annotateState.poseVideoId) throw new Error('No video ID returned from upload');
    }

    // Step 2: Trigger pose analysis
    if (btn) btn.textContent = 'Analysing...';
    showToast('Running pose estimation...', 'info');
    const videoId = annotateState.poseVideoId;
    const analysisResult = await window.api.sync.post(`/video/${videoId}/pose-analysis`, { fps: 2 });
    if (!analysisResult.success) throw new Error(analysisResult.error || 'Analysis failed');

    // Step 3: Fetch the pose data
    const poseResult = await window.api.sync.request(`/video/${videoId}/pose-data`);
    if (!poseResult || poseResult.success === false) throw new Error(poseResult?.error || 'Failed to fetch pose data');

    annotateState.poseData = poseResult.data || poseResult;
    showPoseOverlay();
    renderPoseOverlay();
    renderPoseTimeline();
    showToast('Pose analysis complete', 'success');
  } catch (err) {
    showToast('Pose analysis failed: ' + err.message, 'error');
  } finally {
    annotateState.poseAnalysisRunning = false;
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="5" r="2"/><line x1="12" y1="7" x2="12" y2="15"/><line x1="8" y1="11" x2="16" y2="11"/><line x1="10" y1="21" x2="12" y2="15"/><line x1="14" y1="21" x2="12" y2="15"/></svg> Run Pose Analysis';
    }
  }
}

function showPoseOverlay() {
  const toolbar = document.getElementById('annotatePoseToolbar');
  const canvas = document.getElementById('annotatePoseCanvas');
  const timeline = document.getElementById('annotatePoseTimeline');
  if (toolbar) toolbar.style.display = '';
  if (canvas) canvas.style.display = '';
  if (timeline) timeline.style.display = '';
}

function hidePoseOverlay() {
  const toolbar = document.getElementById('annotatePoseToolbar');
  const canvas = document.getElementById('annotatePoseCanvas');
  const timeline = document.getElementById('annotatePoseTimeline');
  if (toolbar) toolbar.style.display = 'none';
  if (canvas) canvas.style.display = 'none';
  if (timeline) timeline.style.display = 'none';
}

function getPoseFrameAtTime(time) {
  if (!annotateState.poseData || !annotateState.poseData.frames) return null;
  const frames = annotateState.poseData.frames;
  if (frames.length === 0) return null;
  // Find the closest frame to the current time
  let closest = frames[0];
  let minDiff = Math.abs((closest.timestamp || 0) - time);
  for (let i = 1; i < frames.length; i++) {
    const diff = Math.abs((frames[i].timestamp || 0) - time);
    if (diff < minDiff) {
      minDiff = diff;
      closest = frames[i];
    }
  }
  return closest;
}

function renderPoseOverlay() {
  const canvas = document.getElementById('annotatePoseCanvas');
  const video = document.getElementById('annotateVideo');
  if (!canvas || !video || !annotateState.poseData) return;

  // Match canvas size to video display size
  const rect = video.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
  canvas.style.width = rect.width + 'px';
  canvas.style.height = rect.height + 'px';

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const frame = getPoseFrameAtTime(video.currentTime);
  if (!frame || !frame.landmarks) return;

  const landmarks = frame.landmarks;
  // Video natural dimensions for coordinate mapping
  const vw = video.videoWidth || 1;
  const vh = video.videoHeight || 1;

  // Calculate letterboxing offset (object-fit: contain)
  const videoAspect = vw / vh;
  const canvasAspect = canvas.width / canvas.height;
  let drawW, drawH, offsetX, offsetY;
  if (videoAspect > canvasAspect) {
    drawW = canvas.width;
    drawH = canvas.width / videoAspect;
    offsetX = 0;
    offsetY = (canvas.height - drawH) / 2;
  } else {
    drawH = canvas.height;
    drawW = canvas.height * videoAspect;
    offsetX = (canvas.width - drawW) / 2;
    offsetY = 0;
  }

  function toCanvasX(normX) { return offsetX + normX * drawW; }
  function toCanvasY(normY) { return offsetY + normY * drawH; }

  const layers = annotateState.poseLayers;

  // Draw motion trails
  if (layers.trails && annotateState.poseData.frames) {
    const currentIdx = annotateState.poseData.frames.indexOf(frame);
    const trailLength = 8;
    const startIdx = Math.max(0, currentIdx - trailLength);
    const trailJoints = [15, 16, 27, 28]; // wrists and ankles
    ctx.globalAlpha = 0.15;
    for (const jointIdx of trailJoints) {
      ctx.beginPath();
      let started = false;
      for (let i = startIdx; i <= currentIdx; i++) {
        const f = annotateState.poseData.frames[i];
        if (!f.landmarks || !f.landmarks[jointIdx]) continue;
        const lm = f.landmarks[jointIdx];
        const x = toCanvasX(lm.x);
        const y = toCanvasY(lm.y);
        if (!started) { ctx.moveTo(x, y); started = true; } else { ctx.lineTo(x, y); }
      }
      ctx.strokeStyle = '#60A5FA';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // Draw risk zones
  if (layers.zones && frame.risk_score != null) {
    const level = getRiskLevel(frame.risk_score);
    const color = getRiskColor(level);
    // Highlight body region with a semi-transparent overlay
    if (level === 'high' || level === 'very_high') {
      // Draw a subtle glow around the torso area
      const torsoJoints = [11, 12, 23, 24];
      const torsoPoints = torsoJoints.filter(j => landmarks[j]).map(j => ({
        x: toCanvasX(landmarks[j].x),
        y: toCanvasY(landmarks[j].y)
      }));
      if (torsoPoints.length >= 3) {
        ctx.save();
        ctx.globalAlpha = 0.15;
        ctx.fillStyle = color.fg;
        ctx.beginPath();
        ctx.moveTo(torsoPoints[0].x, torsoPoints[0].y);
        for (let i = 1; i < torsoPoints.length; i++) ctx.lineTo(torsoPoints[i].x, torsoPoints[i].y);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }
  }

  // Draw skeleton
  if (layers.skeleton) {
    const riskLevel = frame.risk_score != null ? getRiskLevel(frame.risk_score) : 'low';
    const lineColor = getRiskColor(riskLevel).fg;

    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';

    for (const [a, b] of POSE_CONNECTIONS) {
      if (!landmarks[a] || !landmarks[b]) continue;
      const vis = Math.min(landmarks[a].visibility || 1, landmarks[b].visibility || 1);
      if (vis < 0.3) continue;
      ctx.globalAlpha = Math.max(0.4, vis);
      ctx.beginPath();
      ctx.moveTo(toCanvasX(landmarks[a].x), toCanvasY(landmarks[a].y));
      ctx.lineTo(toCanvasX(landmarks[b].x), toCanvasY(landmarks[b].y));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Draw joint dots
    const jointIndices = new Set(POSE_CONNECTIONS.flat());
    for (const idx of jointIndices) {
      if (!landmarks[idx]) continue;
      const vis = landmarks[idx].visibility || 1;
      if (vis < 0.3) continue;
      const x = toCanvasX(landmarks[idx].x);
      const y = toCanvasY(landmarks[idx].y);
      ctx.fillStyle = '#FFFFFF';
      ctx.globalAlpha = Math.max(0.5, vis);
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // Draw angles
  if (layers.angles && frame.angles) {
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const angleEntries = Object.entries(frame.angles);
    for (const [jointName, angle] of angleEntries) {
      // Map joint name to a landmark index for positioning
      const jointMap = {
        left_elbow: 13, right_elbow: 14,
        left_shoulder: 11, right_shoulder: 12,
        left_knee: 25, right_knee: 26,
        left_hip: 23, right_hip: 24,
        trunk_flexion: 11,
      };
      const lmIdx = jointMap[jointName];
      if (lmIdx == null || !landmarks[lmIdx]) continue;
      const x = toCanvasX(landmarks[lmIdx].x) + 18;
      const y = toCanvasY(landmarks[lmIdx].y) - 10;
      const deg = typeof angle === 'number' ? Math.round(angle) : angle;
      // Background pill
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      const tw = ctx.measureText(deg + '\u00B0').width + 8;
      ctx.beginPath();
      ctx.roundRect(x - tw / 2, y - 8, tw, 16, 4);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(deg + '\u00B0', x, y);
    }
  }

  // Update risk badge
  updatePoseRiskBadge(frame);
}

function updatePoseRiskBadge(frame) {
  const badge = document.getElementById('poseRiskBadge');
  if (!badge) return;
  if (!frame || frame.risk_score == null) {
    badge.textContent = '--';
    badge.style.background = '#E5E7EB';
    badge.style.color = '#374151';
    return;
  }
  const level = getRiskLevel(frame.risk_score);
  const rc = getRiskColor(level);
  badge.textContent = rc.label + ' (' + frame.risk_score.toFixed(1) + ')';
  badge.style.background = rc.bg;
  badge.style.color = rc.fg;
}

function renderPoseTimeline() {
  const container = document.getElementById('annotatePoseTimeline');
  const canvas = document.getElementById('annotatePoseTimelineCanvas');
  const video = document.getElementById('annotateVideo');
  if (!canvas || !video || !annotateState.poseData || !annotateState.poseData.frames) return;
  if (container) container.style.display = '';

  const frames = annotateState.poseData.frames;
  if (frames.length === 0) return;

  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * (window.devicePixelRatio || 1);
  canvas.height = rect.height * (window.devicePixelRatio || 1);
  const ctx = canvas.getContext('2d');
  ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
  const w = rect.width;
  const h = rect.height;

  ctx.clearRect(0, 0, w, h);

  const duration = video.duration || 1;

  // Draw risk-colored segments
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const nextT = i < frames.length - 1 ? frames[i + 1].timestamp : duration;
    const x = (f.timestamp / duration) * w;
    const segW = Math.max(1, ((nextT - f.timestamp) / duration) * w);
    const level = getRiskLevel(f.risk_score);
    ctx.fillStyle = getRiskColor(level).fg;
    ctx.globalAlpha = 0.7;
    ctx.fillRect(x, 0, segW, h);
  }
  ctx.globalAlpha = 1;

  // Draw playhead
  const playheadX = (video.currentTime / duration) * w;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(playheadX - 1, 0, 2, h);
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 0.5;
  ctx.strokeRect(playheadX - 1, 0, 2, h);

  // Click handler for seeking
  canvas.onclick = (e) => {
    const clickRect = canvas.getBoundingClientRect();
    const pct = (e.clientX - clickRect.left) / clickRect.width;
    video.currentTime = pct * video.duration;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// MAPS TAB — Map detail, analytics, runs, improvements
// ═══════════════════════════════════════════════════════════════════════════

let mapsData = [];
let selectedMapId = null;

async function loadMapsList() {
  const container = document.getElementById('mapsListContainer');
  const refreshBtn = document.getElementById('refreshMapsBtn');
  if (refreshBtn) { refreshBtn.textContent = 'Loading...'; refreshBtn.disabled = true; }
  try {
    const result = await window.api.sync.getMaps();
    const maps = result.maps || result.data || [];
    if (!maps || !Array.isArray(maps) || maps.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-icon"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/></svg></div><h3 class="empty-state-title">No Maps</h3><p class="empty-state-text">Create a map from a recording or on the web.</p></div>';
      return;
    }
    mapsData = maps;
    // Update header map count
    const countEl = document.getElementById('headerMapCount');
    if (countEl) countEl.textContent = maps.length;
    renderMapList();
  } catch (err) {
    container.innerHTML = '<div class="text-sm text-muted" style="padding:20px;text-align:center">Failed to load maps. Check connection.</div>';
  } finally {
    if (refreshBtn) { refreshBtn.textContent = 'Refresh'; refreshBtn.disabled = false; }
  }
}

function renderMapList() {
  const container = document.getElementById('mapsListContainer');
  if (!mapsData.length) {
    container.innerHTML = '<div class="empty-state"><h3 class="empty-state-title">No Maps Yet</h3><p class="empty-state-text">Create a map from a recording or on the web.</p></div>';
    return;
  }
  container.innerHTML = mapsData.map(m => {
    const stages = m.stages_count || m.stage_count || 0;
    const pce = m.pce ? m.pce.toFixed(1) + '%' : '—';
    return `
      <div class="card card-interactive" onclick="showMapDetail(${m.id})" style="margin-bottom:8px;padding:14px;cursor:pointer;">
        <div style="display:flex;justify-content:space-between;align-items:start;">
          <div>
            <div class="font-semibold">${escapeHtml(m.name)}</div>
            <div class="text-sm text-muted" style="margin-top:2px;">${escapeHtml(m.description || '')}</div>
          </div>
          <div style="text-align:right;flex-shrink:0;">
            <span class="badge">${stages} stages</span>
            ${m.industry ? '<span class="badge" style="margin-left:4px;">' + escapeHtml(m.industry) + '</span>' : ''}
          </div>
        </div>
        <div style="display:flex;gap:16px;margin-top:8px;" class="text-sm text-muted">
          <span>PCE: <strong class="${parseFloat(pce) > 25 ? 'text-success' : 'text-warning'}">${pce}</strong></span>
          ${m.lead_time_hrs ? '<span>Lead: <strong>' + formatHrs(m.lead_time_hrs) + '</strong></span>' : ''}
          ${m.cycle_time_hrs ? '<span>Cycle: <strong>' + formatHrs(m.cycle_time_hrs) + '</strong></span>' : ''}
        </div>
      </div>`;
  }).join('');
}

async function showMapDetail(mapId) {
  selectedMapId = mapId;
  document.getElementById('mapsListContainer').classList.add('hidden');
  document.getElementById('mapDetailPanel').classList.remove('hidden');

  // Fetch map detail from API
  try {
    const rawResult = await window.api.sync.request(`/maps/${mapId}`);
    // Handle various response shapes: {success,data:{data:{...}}}, {data:{...}}, {status,data:{...}}
    let map;
    if (rawResult?.success && rawResult.data) {
      map = rawResult.data.data || rawResult.data;
    } else if (rawResult?.data) {
      map = rawResult.data;
    } else {
      map = rawResult;
    }
    if (!map || map.status === 'error') throw new Error('Failed');

    document.getElementById('mapDetailTitle').textContent = map.name || '';
    document.getElementById('mapDetailDesc').textContent = map.description || '';
    document.getElementById('mapDetailIndustry').textContent = map.industry || 'General';
    document.getElementById('mapDetailState').textContent = map.map_state === 'future_state' ? 'Future State' : 'Current State';
    document.getElementById('mapDetailStages').textContent = (map.stages?.length || 0) + ' stages';

    // Calculate metrics
    const stages = map.stages || [];
    let totalCycle = 0, totalWait = 0, vaTime = 0, bottleneck = { name: '—', ct: 0 };
    stages.forEach(s => {
      const ct = parseFloat(s.cycle_time_hrs) || 0;
      const wt = parseFloat(s.wait_time_hrs) || 0;
      totalCycle += ct;
      totalWait += wt;
      if (s.value_add) vaTime += ct;
      if (ct > bottleneck.ct) bottleneck = { name: s.stage, ct: ct };
    });
    const leadTime = totalCycle + totalWait;
    const pce = leadTime > 0 ? (vaTime / leadTime * 100) : 0;

    document.getElementById('mapMetricLeadTime').textContent = formatHrs(leadTime);
    document.getElementById('mapMetricCycleTime').textContent = formatHrs(totalCycle);
    document.getElementById('mapMetricPCE').textContent = pce.toFixed(1) + '%';
    document.getElementById('mapMetricBottleneck').textContent = bottleneck.name;

    // Stages table
    const tbody = document.getElementById('mapStagesBody');
    tbody.innerHTML = stages.map((s, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(s.stage || s.name || '')}</td>
        <td class="text-right">${(parseFloat(s.cycle_time_hrs) || 0).toFixed(2)}</td>
        <td class="text-right">${(parseFloat(s.wait_time_hrs) || 0).toFixed(2)}</td>
        <td><span class="badge badge-${s.value_add ? 'success' : 'warning'}">${s.work_type || (s.value_add ? 'VA' : 'NVA')}</span></td>
        <td class="text-muted">${escapeHtml(s.resource || '')}</td>
      </tr>`).join('');

    // Load runs
    await loadMapRuns(mapId);

    // Load improvements
    await loadMapImprovements(mapId);

  } catch (err) {
    document.getElementById('mapDetailTitle').textContent = 'Error loading map';
  }

  // Wire up browser buttons
  const baseUrl = (await window.api.settings.get()).api_url?.replace('/api/v1', '') || 'https://mapvs.com';
  document.getElementById('openRunsWebBtn').onclick = () => window.api.system?.openExternal?.(`${baseUrl}/maps/${mapId}`) || window.open(`${baseUrl}/maps/${mapId}`);
  document.getElementById('openImprovementsWebBtn').onclick = () => window.api.system?.openExternal?.(`${baseUrl}/improvements`) || window.open(`${baseUrl}/improvements`);
  document.getElementById('openAnalyticsWebBtn').onclick = () => window.api.system?.openExternal?.(`${baseUrl}/analytics`) || window.open(`${baseUrl}/analytics`);
  document.getElementById('openCanvasWebBtn').onclick = () => window.api.system?.openExternal?.(`${baseUrl}/canvas/${mapId}`) || window.open(`${baseUrl}/canvas/${mapId}`);
  document.getElementById('openSimulateWebBtn').onclick = () => window.api.system?.openExternal?.(`${baseUrl}/maps/${mapId}/simulate`) || window.open(`${baseUrl}/maps/${mapId}/simulate`);
  document.getElementById('openLineBalanceWebBtn').onclick = () => window.api.system?.openExternal?.(`${baseUrl}/maps/${mapId}/line-balance`) || window.open(`${baseUrl}/maps/${mapId}/line-balance`);
  document.getElementById('openOEEWebBtn').onclick = () => window.api.system?.openExternal?.(`${baseUrl}/maps/${mapId}/oee`) || window.open(`${baseUrl}/maps/${mapId}/oee`);
}

async function loadMapRuns(mapId) {
  const container = document.getElementById('mapRunsList');
  try {
    const result = await window.api.sync.getMapRuns(mapId);
    const runs = result?.runs || result?.data?.runs || [];
    if (!runs.length) {
      container.innerHTML = '<div class="text-sm text-muted" style="padding:12px;">No recording runs yet.</div>';
      return;
    }
    container.innerHTML = runs.map(r => `
      <div class="card" style="padding:10px;margin-bottom:6px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <span class="font-semibold">Run #${r.run_number}</span>
            ${r.label ? '<span class="text-muted text-sm"> — ' + escapeHtml(r.label) + '</span>' : ''}
          </div>
          <span class="badge badge-${r.status === 'completed' ? 'success' : 'warning'}">${r.status || 'pending'}</span>
        </div>
        <div class="text-sm text-muted" style="margin-top:4px;">
          ${r.source_device || 'web'} · ${r.created_at ? new Date(r.created_at).toLocaleDateString() : ''}
        </div>
      </div>`).join('');
  } catch (err) {
    container.innerHTML = '<div class="text-sm text-muted" style="padding:12px;">Could not load runs.</div>';
  }
}

async function loadMapImprovements(mapId) {
  const container = document.getElementById('mapImprovementsList');
  try {
    const result = await window.api.sync.request(`/maps/${mapId}/improvements`);
    const items = result?.data?.improvements || result?.improvements || [];
    if (!items.length) {
      container.innerHTML = '<div class="text-sm text-muted" style="padding:12px;">No improvements tracked.</div>';
      return;
    }
    const statusColors = { identified: 'warning', planned: 'info', in_progress: 'primary', verified: 'success', completed: 'success', closed: 'muted' };
    container.innerHTML = items.map(imp => `
      <div class="card" style="padding:10px;margin-bottom:6px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span class="font-semibold text-sm">${escapeHtml(imp.title)}</span>
          <span class="badge badge-${statusColors[imp.status] || 'muted'}">${imp.status || 'identified'}</span>
        </div>
        ${imp.description ? '<div class="text-sm text-muted" style="margin-top:2px;">' + escapeHtml(imp.description) + '</div>' : ''}
      </div>`).join('');
  } catch (err) {
    container.innerHTML = '<div class="text-sm text-muted" style="padding:12px;">Could not load improvements.</div>';
  }
}

function formatHrs(v) {
  v = parseFloat(v) || 0;
  if (v < 1 / 60) return (v * 3600).toFixed(0) + 's';
  if (v < 1) return (v * 60).toFixed(1) + 'm';
  return v.toFixed(2) + 'h';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Wire up Maps tab buttons
document.addEventListener('DOMContentLoaded', () => {
  const refreshBtn = document.getElementById('refreshMapsBtn');
  if (refreshBtn) refreshBtn.addEventListener('click', loadMapsList);

  const openWebBtn = document.getElementById('openMapsWebBtn');
  if (openWebBtn) openWebBtn.addEventListener('click', async () => {
    const settings = await window.api.settings.get();
    const baseUrl = settings.api_url?.replace('/api/v1', '') || 'https://mapvs.com';
    window.api.system?.openExternal?.(`${baseUrl}/maps`) || window.open(`${baseUrl}/maps`);
  });

  const backBtn = document.getElementById('backToMapListBtn');
  if (backBtn) backBtn.addEventListener('click', () => {
    document.getElementById('mapDetailPanel').classList.add('hidden');
    document.getElementById('mapsListContainer').classList.remove('hidden');
  });

  // Auto-load maps when Maps tab is activated
  const mapsTabBtn = document.querySelector('[data-tab="maps"]');
  if (mapsTabBtn) {
    mapsTabBtn.addEventListener('click', () => {
      if (!mapsData.length) loadMapsList();
    });
  }
});
