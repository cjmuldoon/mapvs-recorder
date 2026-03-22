const { app, BrowserWindow, ipcMain, dialog, shell, globalShortcut, nativeImage, screen, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');
const { setupTray } = require('./tray');
const { captureScreen, captureRegion, getActiveWindow, getDisplays, getActiveDisplay } = require('../capture/screenshot');
const { Recorder } = require('../capture/recorder');

let regionOverlayWindow = null;

const store = new Store({
  defaults: {
    api_url: 'https://mapvs.com/api/v1',
    token: null,
    preferences: {
      screenshot_interval: 5000,
      screenshot_quality: 'medium',
      auto_capture_on_window_change: true,
      storage_path: path.join(app.getPath('userData'), 'recordings')
    }
  }
});

let mainWindow = null;
let tray = null;
let recorder = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    icon: path.join(__dirname, '../../assets/icon.png')
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function showWindow() {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  } else {
    createWindow();
  }
}

function registerShortcuts() {
  globalShortcut.register('CommandOrControl+Shift+N', () => {
    if (recorder && recorder.status === 'recording') {
      mainWindow?.webContents.send('shortcut:new-step');
    }
  });

  globalShortcut.register('CommandOrControl+Shift+S', () => {
    if (recorder && recorder.status === 'recording') {
      mainWindow?.webContents.send('shortcut:stop');
    }
  });
}

function setupIPC() {
  // Auth handlers
  ipcMain.handle('auth:login', async () => {
    const apiUrl = store.get('api_url', 'https://mapvs.com/api/v1');
    const baseUrl = apiUrl.replace('/api/v1', '');
    await shell.openExternal(`${baseUrl}/oauth/authorize?client=recorder&redirect=mapvs-recorder://auth`);
    return true;
  });

  ipcMain.handle('auth:set-token', async (_event, token) => {
    store.set('token', token);
    return true;
  });

  ipcMain.handle('auth:get-token', async () => {
    return store.get('token');
  });

  ipcMain.handle('auth:logout', async () => {
    store.delete('token');
    return true;
  });

  // Capture handlers
  ipcMain.handle('capture:screenshot', async () => {
    try {
      const storagePath = store.get('preferences.storage_path');
      const screenshotPath = await captureScreen(storagePath);
      return { success: true, path: screenshotPath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('capture:screenshot-region', async (_event, bounds) => {
    try {
      const storagePath = store.get('preferences.storage_path');
      const screenshotPath = await captureRegion(bounds, storagePath);
      return { success: true, path: screenshotPath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('capture:active-window', async () => {
    try {
      const winInfo = await getActiveWindow();
      return { success: true, data: winInfo };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Region selection overlay
  ipcMain.handle('capture:select-region', async () => {
    return new Promise((resolve) => {
      // Close any existing overlay
      if (regionOverlayWindow && !regionOverlayWindow.isDestroyed()) {
        regionOverlayWindow.close();
        regionOverlayWindow = null;
      }

      // Get the primary display bounds for full-screen overlay
      const display = screen.getPrimaryDisplay();
      const { x, y, width, height } = display.bounds;

      regionOverlayWindow = new BrowserWindow({
        x,
        y,
        width,
        height,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        movable: false,
        fullscreenable: false,
        hasShadow: false,
        webPreferences: {
          contextIsolation: false,
          nodeIntegration: true
        }
      });

      regionOverlayWindow.setVisibleOnAllWorkspaces(true);
      regionOverlayWindow.loadFile(path.join(__dirname, '../capture/region-overlay.html'));

      // Prevent the overlay window from being hidden behind other windows
      regionOverlayWindow.setAlwaysOnTop(true, 'screen-saver');

      ipcMain.once('region-overlay:selected', (_event, bounds) => {
        // Store the selected region persistently
        store.set('capture_region', bounds);

        if (regionOverlayWindow && !regionOverlayWindow.isDestroyed()) {
          regionOverlayWindow.close();
        }
        regionOverlayWindow = null;

        resolve({ success: true, bounds });
      });

      ipcMain.once('region-overlay:cancel', () => {
        if (regionOverlayWindow && !regionOverlayWindow.isDestroyed()) {
          regionOverlayWindow.close();
        }
        regionOverlayWindow = null;

        resolve({ success: false, cancelled: true });
      });

      regionOverlayWindow.on('closed', () => {
        regionOverlayWindow = null;
        // Clean up listeners if window was closed externally
        ipcMain.removeAllListeners('region-overlay:selected');
        ipcMain.removeAllListeners('region-overlay:cancel');
        resolve({ success: false, cancelled: true });
      });
    });
  });

  ipcMain.handle('capture:set-region', async (_event, bounds) => {
    store.set('capture_region', bounds);
    return { success: true, bounds };
  });

  ipcMain.handle('capture:clear-region', async () => {
    store.delete('capture_region');
    return { success: true };
  });

  ipcMain.handle('capture:get-region', async () => {
    const region = store.get('capture_region', null);
    return { success: true, bounds: region };
  });

  // Dialog handlers
  ipcMain.handle('dialog:openFile', async () => {
    const result = await dialog.showOpenDialog({
      filters: [{ name: 'Session', extensions: ['json'] }],
      properties: ['openFile']
    });
    if (result.canceled) return null;
    return fs.readFileSync(result.filePaths[0], 'utf8');
  });

  // Photo/file attachment handler
  ipcMain.handle('capture:attachFile', async () => {
    const result = await dialog.showOpenDialog({
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
      properties: ['openFile']
    });
    if (result.canceled) return null;

    const sourcePath = result.filePaths[0];
    const storagePath = store.get('preferences.storage_path');
    const filename = `attachment_${Date.now()}_${path.basename(sourcePath)}`;
    const destPath = path.join(storagePath, filename);

    // Ensure storage dir exists
    if (!fs.existsSync(storagePath)) {
      fs.mkdirSync(storagePath, { recursive: true });
    }

    fs.copyFileSync(sourcePath, destPath);
    return destPath;
  });

  // Recording handlers
  ipcMain.handle('recording:start', async (_event, mode) => {
    const interval = store.get('preferences.screenshot_interval', 5000);
    const quality = store.get('preferences.screenshot_quality', 'medium');
    const storagePath = store.get('preferences.storage_path');
    const captureRegionBounds = store.get('capture_region', null);
    recorder = new Recorder({ mode, interval, storagePath, captureRegionBounds, quality });
    await recorder.start();
    if (tray) tray.updateStatus('recording');
    mainWindow?.webContents.send('recording:status-changed', 'recording');
    return { success: true, sessionId: recorder.sessionId };
  });

  ipcMain.handle('recording:stop', async () => {
    if (!recorder) return { success: false, error: 'No active recording' };
    const result = await recorder.stop();
    if (tray) tray.updateStatus('idle');
    mainWindow?.webContents.send('recording:status-changed', 'idle');
    return { success: true, data: result };
  });

  ipcMain.handle('recording:add-step', async (_event, stepData) => {
    if (!recorder) return { success: false, error: 'No active recording' };
    try {
      // Support both string (legacy) and object { notes, resource, attachments }
      const opts = typeof stepData === 'string' ? { notes: stepData } : (stepData || {});
      const step = await recorder.addStep(opts.notes || '', opts.resource || '', opts.attachments || []);
      return { success: true, data: step };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('recording:get-status', async () => {
    if (!recorder) return { status: 'idle', steps: [], mode: null };
    return {
      status: recorder.status,
      steps: recorder.steps,
      mode: recorder.mode,
      startTime: recorder.startTime,
      stepCount: recorder.steps.length
    };
  });

  // Sync handlers
  ipcMain.handle('sync:upload', async (_event, { mapId, recording }) => {
    const token = store.get('token');
    const apiUrl = store.get('api_url');
    if (!token) return { success: false, error: 'Not authenticated' };

    try {
      const api = require('../sync/api');
      const result = await api.uploadRecording(token, apiUrl, mapId, recording);
      if (tray) tray.updateStatus('idle');
      return { success: true, data: result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('sync:test-connection', async () => {
    const token = store.get('token');
    const apiUrl = store.get('api_url');
    if (!token) return { success: false, error: 'No token configured' };

    try {
      const api = require('../sync/api');
      const connected = await api.testConnection(token, apiUrl);
      return { success: true, connected };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('sync:get-maps', async () => {
    const token = store.get('token');
    const apiUrl = store.get('api_url');
    if (!token) return { success: false, error: 'No token configured' };

    try {
      const api = require('../sync/api');
      const maps = await api.getMaps(token, apiUrl);
      return { success: true, data: maps };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('sync:create-map', async (_event, { name, recording }) => {
    const token = store.get('token');
    const apiUrl = store.get('api_url');
    if (!token) return { success: false, error: 'No token configured' };

    try {
      const api = require('../sync/api');
      const result = await api.createMapFromRecording(token, apiUrl, name, recording);
      return { success: true, data: result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Template handlers
  ipcMain.handle('sync:get-templates', async () => {
    const token = store.get('token');
    const apiUrl = store.get('api_url');
    if (!token) return { success: false, error: 'No token configured' };

    try {
      const api = require('../sync/api');
      const templates = await api.getTemplates(token, apiUrl);
      return { success: true, data: templates };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // System handlers (idle detection for Feature 2)
  ipcMain.handle('system:getIdleTime', async () => {
    return powerMonitor.getSystemIdleTime();
  });

  // Multi-monitor handlers (Feature 3)
  ipcMain.handle('capture:getDisplays', async () => {
    return getDisplays();
  });

  ipcMain.handle('capture:setActiveDisplay', async (_event, displayId) => {
    store.set('capture_display_id', displayId);
    return { success: true };
  });

  ipcMain.handle('capture:setFollowActiveWindow', async (_event, follow) => {
    store.set('capture_follow_active_window', follow);
    return { success: true };
  });

  ipcMain.handle('capture:getDisplaySettings', async () => {
    return {
      displayId: store.get('capture_display_id', null),
      followActiveWindow: store.get('capture_follow_active_window', false)
    };
  });

  // Settings handlers
  ipcMain.handle('settings:get', async () => {
    return {
      api_url: store.get('api_url'),
      preferences: store.get('preferences'),
      has_token: !!store.get('token')
    };
  });

  ipcMain.handle('settings:set', async (_event, settings) => {
    if (settings.api_url) store.set('api_url', settings.api_url);
    if (settings.preferences) {
      const current = store.get('preferences');
      store.set('preferences', { ...current, ...settings.preferences });
    }
    return { success: true };
  });

  ipcMain.handle('settings:clear-data', async () => {
    const fs = require('fs');
    const storagePath = store.get('preferences.storage_path');
    try {
      if (fs.existsSync(storagePath)) {
        fs.rmSync(storagePath, { recursive: true, force: true });
        fs.mkdirSync(storagePath, { recursive: true });
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}

// App lifecycle
app.whenReady().then(() => {
  createWindow();
  tray = setupTray(showWindow, () => {
    if (recorder && recorder.status === 'recording') {
      mainWindow?.webContents.send('shortcut:stop');
    }
  });
  registerShortcuts();
  setupIPC();

  // Ensure storage directory exists
  const fs = require('fs');
  const storagePath = store.get('preferences.storage_path');
  if (!fs.existsSync(storagePath)) {
    fs.mkdirSync(storagePath, { recursive: true });
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  showWindow();
});

app.on('before-quit', () => {
  app.isQuitting = true;
  globalShortcut.unregisterAll();
});

// Handle deep link for OAuth callback
app.setAsDefaultProtocolClient('mapvs-recorder');
app.on('open-url', (_event, url) => {
  const urlObj = new URL(url);
  const token = urlObj.searchParams.get('token');
  if (token) {
    store.set('token', token);
    mainWindow?.webContents.send('auth:token-received', token);
  }
});
