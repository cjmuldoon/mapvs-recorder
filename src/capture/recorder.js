const { captureScreen, captureRegion, getActiveWindow, getActiveDisplay } = require('./screenshot');
const { v4: uuidv4 } = require('crypto');
const path = require('path');
const fs = require('fs');

// Import powerMonitor from electron (available in main process)
let powerMonitor;
try {
  powerMonitor = require('electron').powerMonitor;
} catch (e) {
  powerMonitor = null;
}

class Recorder {
  /**
   * @param {{ mode: 'screen' | 'manual', interval: number, storagePath: string, captureRegionBounds?: object, idleThreshold?: number, displayId?: number, followActiveWindow?: boolean }} options
   */
  constructor({ mode = 'manual', interval = 5000, storagePath, captureRegionBounds = null, idleThreshold = 5, displayId = null, followActiveWindow = false }) {
    this.sessionId = generateId();
    this.mode = mode;
    this.interval = interval;
    this.storagePath = path.join(storagePath, this.sessionId);
    this.captureRegionBounds = captureRegionBounds;
    this.idleThreshold = idleThreshold; // seconds — Feature 2
    this.displayId = displayId; // Feature 3: specific display to capture
    this.followActiveWindow = followActiveWindow; // Feature 3: follow active window across monitors
    this.steps = [];
    this.startTime = null;
    this.endTime = null;
    this.status = 'idle'; // idle | recording | stopped
    this._intervalTimer = null;
    this._lastWindowTitle = null;
    this._lastActivityTime = null; // Feature 2: track last activity
    this._stepIdleAccumulator = 0; // Feature 2: accumulated idle time for current step
  }

  /**
   * Start the recording session.
   */
  async start() {
    // Create session directory
    if (!fs.existsSync(this.storagePath)) {
      fs.mkdirSync(this.storagePath, { recursive: true });
    }

    this.startTime = new Date().toISOString();
    this.status = 'recording';
    this.steps = [];
    this._lastActivityTime = Date.now();
    this._stepIdleAccumulator = 0;

    if (this.mode === 'screen') {
      await this._captureStep('Recording started');
      this._startAutoCapture();
    }

    return { sessionId: this.sessionId, mode: this.mode };
  }

  /**
   * Stop the recording session.
   * @returns {{ sessionId: string, steps: Array, startTime: string, endTime: string, mode: string }}
   */
  async stop() {
    if (this._intervalTimer) {
      clearInterval(this._intervalTimer);
      this._intervalTimer = null;
    }

    this.endTime = new Date().toISOString();
    this.status = 'stopped';

    // Calculate durations between steps and idle/active split
    for (let i = 0; i < this.steps.length; i++) {
      if (i < this.steps.length - 1) {
        const current = new Date(this.steps[i].timestamp);
        const next = new Date(this.steps[i + 1].timestamp);
        this.steps[i].duration_secs = (next - current) / 1000;
      } else {
        const current = new Date(this.steps[i].timestamp);
        const end = new Date(this.endTime);
        this.steps[i].duration_secs = (end - current) / 1000;
      }

      // Feature 2: finalize idle/active split and auto-classify
      const step = this.steps[i];
      const totalDuration = step.duration_secs || 0;
      const idleSecs = step.idle_seconds || 0;
      step.active_seconds = Math.max(0, totalDuration - idleSecs);

      // Auto-classify VA type based on idle ratio
      if (step.va_type === 'undetermined' && totalDuration > 0) {
        const idleRatio = idleSecs / totalDuration;
        if (idleRatio < 0.2) {
          step.va_type = 'va';
          step.auto_classified = true;
        } else if (idleRatio > 0.5) {
          step.va_type = 'nva';
          step.auto_classified = true;
        }
        // Otherwise leave as undetermined
      }
    }

    // Save session metadata
    const sessionData = {
      sessionId: this.sessionId,
      mode: this.mode,
      startTime: this.startTime,
      endTime: this.endTime,
      steps: this.steps
    };

    const metadataPath = path.join(this.storagePath, 'session.json');
    fs.writeFileSync(metadataPath, JSON.stringify(sessionData, null, 2));

    return sessionData;
  }

  /**
   * Add a manual step (used in manual mode, or to annotate in screen mode).
   * @param {string} notes - User notes for this step
   * @returns {Promise<object>} The captured step
   */
  async addStep(notes = '') {
    if (this.status !== 'recording') {
      throw new Error('Not currently recording');
    }
    return this._captureStep(notes);
  }

  /**
   * Get current system idle time in seconds.
   * Uses Electron's powerMonitor.getSystemIdleTime().
   * @returns {number} Idle seconds
   */
  _getIdleTime() {
    if (powerMonitor && typeof powerMonitor.getSystemIdleTime === 'function') {
      return powerMonitor.getSystemIdleTime();
    }
    return 0;
  }

  /**
   * Internal: capture a single step with screenshot and window info.
   */
  async _captureStep(notes = '') {
    const timestamp = new Date().toISOString();
    let screenshotPath = null;
    let windowInfo = { title: 'Unknown', app: 'Unknown', bounds: null };

    // Feature 2: check idle time before capture
    const idleTimeSecs = this._getIdleTime();
    const isIdle = idleTimeSecs >= this.idleThreshold;

    // Feature 3: determine which display to capture
    let captureDisplayId = this.displayId;
    if (this.followActiveWindow) {
      try {
        captureDisplayId = await getActiveDisplay();
      } catch (err) {
        console.error('Failed to detect active display:', err.message);
      }
    }

    try {
      if (this.captureRegionBounds) {
        screenshotPath = await captureRegion(this.captureRegionBounds, this.storagePath);
      } else {
        screenshotPath = await captureScreen(this.storagePath, captureDisplayId);
      }
    } catch (err) {
      console.error('Screenshot capture failed:', err.message);
    }

    try {
      windowInfo = await getActiveWindow() || windowInfo;
    } catch (err) {
      console.error('Active window detection failed:', err.message);
    }

    // Feature 2: accumulate idle time for step tracking
    const stepIdleSecs = isIdle ? idleTimeSecs : 0;

    const step = {
      order: this.steps.length + 1,
      timestamp,
      duration_secs: 0,
      screenshot_path: screenshotPath,
      window_title: windowInfo.title,
      app_name: windowInfo.app,
      notes: notes,
      stage_name: deriveStageNameFromWindow(windowInfo.title, windowInfo.app),
      va_type: 'undetermined', // va | nva | undetermined
      cycle_time: 0,
      wait_time: isIdle ? stepIdleSecs : 0,
      // Feature 2: idle detection fields
      idle_seconds: stepIdleSecs,
      active_seconds: 0, // Will be finalized in stop()
      auto_classified: false // Will be set in stop() if auto-classified
    };

    this.steps.push(step);
    this._lastWindowTitle = windowInfo.title;

    return step;
  }

  /**
   * Start automatic screen capture at the configured interval.
   */
  _startAutoCapture() {
    this._intervalTimer = setInterval(async () => {
      if (this.status !== 'recording') {
        clearInterval(this._intervalTimer);
        return;
      }

      try {
        const windowInfo = await getActiveWindow();
        const windowChanged = windowInfo && windowInfo.title !== this._lastWindowTitle;

        // In screen mode, capture on every interval
        // Mark window changes as potential step boundaries
        const notes = windowChanged
          ? `Window changed: ${windowInfo.title}`
          : '';

        // Feature 2: check idle state and annotate
        const idleTimeSecs = this._getIdleTime();
        const isIdle = idleTimeSecs >= this.idleThreshold;
        const idleNote = isIdle ? ` [Idle: ${idleTimeSecs}s]` : '';

        await this._captureStep(notes + idleNote);
      } catch (err) {
        console.error('Auto-capture failed:', err.message);
      }
    }, this.interval);
  }
}

/**
 * Derive a stage name from the window title and app name.
 */
function deriveStageNameFromWindow(title, app) {
  if (!title || title === 'Unknown') return app || 'Unknown Stage';

  // Clean up common title patterns
  const cleaned = title
    .replace(/\s*[-|]\s*.*$/, '')  // Remove everything after - or |
    .replace(/\s*\(.*\)$/, '')     // Remove trailing parenthetical
    .trim();

  return cleaned || app || 'Unknown Stage';
}

/**
 * Generate a simple unique ID without requiring uuid package.
 */
function generateId() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `rec_${timestamp}_${random}`;
}

module.exports = { Recorder };
