const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Auth
  auth: {
    login: () => ipcRenderer.invoke('auth:login'),
    setToken: (token) => ipcRenderer.invoke('auth:set-token', token),
    getToken: () => ipcRenderer.invoke('auth:get-token'),
    logout: () => ipcRenderer.invoke('auth:logout'),
    onTokenReceived: (callback) => ipcRenderer.on('auth:token-received', (_e, token) => callback(token))
  },

  // Capture
  capture: {
    screenshot: () => ipcRenderer.invoke('capture:screenshot'),
    screenshotRegion: (bounds) => ipcRenderer.invoke('capture:screenshot-region', bounds),
    activeWindow: () => ipcRenderer.invoke('capture:active-window')
  },

  // Recording
  recording: {
    start: (mode) => ipcRenderer.invoke('recording:start', mode),
    stop: () => ipcRenderer.invoke('recording:stop'),
    addStep: (notes) => ipcRenderer.invoke('recording:add-step', notes),
    getStatus: () => ipcRenderer.invoke('recording:get-status'),
    onStatusChanged: (callback) => ipcRenderer.on('recording:status-changed', (_e, status) => callback(status)),
    onNewStep: (callback) => ipcRenderer.on('shortcut:new-step', () => callback()),
    onStopShortcut: (callback) => ipcRenderer.on('shortcut:stop', () => callback())
  },

  // Sync
  sync: {
    upload: (data) => ipcRenderer.invoke('sync:upload', data),
    testConnection: () => ipcRenderer.invoke('sync:test-connection'),
    getMaps: () => ipcRenderer.invoke('sync:get-maps'),
    createMap: (data) => ipcRenderer.invoke('sync:create-map', data)
  },

  // Settings
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (settings) => ipcRenderer.invoke('settings:set', settings),
    clearData: () => ipcRenderer.invoke('settings:clear-data')
  }
});
