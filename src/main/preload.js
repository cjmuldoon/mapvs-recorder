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
    activeWindow: () => ipcRenderer.invoke('capture:active-window'),
    selectRegion: () => ipcRenderer.invoke('capture:select-region'),
    setRegion: (bounds) => ipcRenderer.invoke('capture:set-region', bounds),
    clearRegion: () => ipcRenderer.invoke('capture:clear-region'),
    getRegion: () => ipcRenderer.invoke('capture:get-region'),
    getDisplays: () => ipcRenderer.invoke('capture:getDisplays'),
    setActiveDisplay: (id) => ipcRenderer.invoke('capture:setActiveDisplay', id),
    setFollowActiveWindow: (follow) => ipcRenderer.invoke('capture:setFollowActiveWindow', follow),
    getDisplaySettings: () => ipcRenderer.invoke('capture:getDisplaySettings'),
    attachFile: () => ipcRenderer.invoke('capture:attachFile')
  },

  // Dialog
  dialog: {
    openFile: () => ipcRenderer.invoke('dialog:openFile')
  },

  // System
  system: {
    getIdleTime: () => ipcRenderer.invoke('system:getIdleTime')
  },

  // Recording
  recording: {
    start: (mode) => ipcRenderer.invoke('recording:start', mode),
    stop: () => ipcRenderer.invoke('recording:stop'),
    addStep: (stepData) => ipcRenderer.invoke('recording:add-step', stepData),
    getStatus: () => ipcRenderer.invoke('recording:get-status'),
    delete: (sessionPath) => ipcRenderer.invoke('recording:delete', sessionPath),
    listDeleted: () => ipcRenderer.invoke('recording:list-deleted'),
    restore: (deletedPath) => ipcRenderer.invoke('recording:restore', deletedPath),
    permanentDelete: (deletedPath) => ipcRenderer.invoke('recording:permanent-delete', deletedPath),
    onStatusChanged: (callback) => ipcRenderer.on('recording:status-changed', (_e, status) => callback(status)),
    onNewStep: (callback) => ipcRenderer.on('shortcut:new-step', () => callback()),
    onStopShortcut: (callback) => ipcRenderer.on('shortcut:stop', () => callback())
  },

  // Sync
  sync: {
    upload: (data) => ipcRenderer.invoke('sync:upload', data),
    testConnection: () => ipcRenderer.invoke('sync:test-connection'),
    getMaps: () => ipcRenderer.invoke('sync:get-maps'),
    createMap: (data) => ipcRenderer.invoke('sync:create-map', data),
    getTemplates: () => ipcRenderer.invoke('sync:get-templates'),
    getNotificationCount: () => ipcRenderer.invoke('sync:get-notification-count'),
    getNotifications: () => ipcRenderer.invoke('sync:get-notifications'),
    getStats: () => ipcRenderer.invoke('sync:get-stats'),
    getMapPresence: (mapId) => ipcRenderer.invoke('sync:get-map-presence', mapId)
  },

  // Settings
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (settings) => ipcRenderer.invoke('settings:set', settings),
    clearData: () => ipcRenderer.invoke('settings:clear-data')
  },

  // App / Auto-update
  app: {
    checkUpdate: () => ipcRenderer.invoke('app:check-update'),
    installUpdate: () => ipcRenderer.invoke('app:install-update'),
    getVersion: () => ipcRenderer.invoke('app:get-version'),
    onUpdateAvailable: (cb) => ipcRenderer.on('update:available', (_e, info) => cb(info)),
    onUpdateDownloaded: (cb) => ipcRenderer.on('update:downloaded', (_e, info) => cb(info)),
    onDownloadProgress: (cb) => ipcRenderer.on('update:progress', (_e, progress) => cb(progress))
  }
});
