// __tests__/preload.test.js — mapvs-recorder
// Tests for src/main/preload.js (IPC security bridge)
//
// preload.js calls contextBridge.exposeInMainWorld — we verify the API shape
// and that each function invokes the correct ipcRenderer channel.

const mockIpcRenderer = {
  invoke: jest.fn().mockResolvedValue(undefined),
  on: jest.fn().mockReturnValue(undefined),
};

const mockContextBridge = {
  exposeInMainWorld: jest.fn(),
};

jest.mock('electron', () => ({
  contextBridge: mockContextBridge,
  ipcRenderer: mockIpcRenderer,
}));

// Load preload.js — executes immediately, calling exposeInMainWorld
require('../src/main/preload');

// Extract the exposed api object from the exposeInMainWorld call
const [[, exposedApi]] = mockContextBridge.exposeInMainWorld.mock.calls;

describe('preload — exposeInMainWorld', () => {
  it('exposes api to the main world', () => {
    expect(mockContextBridge.exposeInMainWorld).toHaveBeenCalledTimes(1);
    expect(mockContextBridge.exposeInMainWorld).toHaveBeenCalledWith('api', expect.any(Object));
  });

  it('exposed api has all expected top-level namespaces', () => {
    expect(exposedApi).toHaveProperty('auth');
    expect(exposedApi).toHaveProperty('capture');
    expect(exposedApi).toHaveProperty('dialog');
    expect(exposedApi).toHaveProperty('system');
    expect(exposedApi).toHaveProperty('recording');
    expect(exposedApi).toHaveProperty('sync');
    expect(exposedApi).toHaveProperty('settings');
    expect(exposedApi).toHaveProperty('app');
  });
});

describe('preload — auth namespace', () => {
  beforeEach(() => mockIpcRenderer.invoke.mockClear());

  it('auth.login invokes auth:login', async () => {
    await exposedApi.auth.login();
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('auth:login');
  });

  it('auth.setToken invokes auth:set-token with token', async () => {
    await exposedApi.auth.setToken('tok_xyz');
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('auth:set-token', 'tok_xyz');
  });

  it('auth.getToken invokes auth:get-token', async () => {
    await exposedApi.auth.getToken();
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('auth:get-token');
  });

  it('auth.logout invokes auth:logout', async () => {
    await exposedApi.auth.logout();
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('auth:logout');
  });

  it('auth.onTokenReceived registers ipcRenderer.on listener', () => {
    const cb = jest.fn();
    exposedApi.auth.onTokenReceived(cb);
    expect(mockIpcRenderer.on).toHaveBeenCalledWith('auth:token-received', expect.any(Function));
  });
});

describe('preload — capture namespace', () => {
  beforeEach(() => mockIpcRenderer.invoke.mockClear());

  it('capture.screenshot invokes capture:screenshot', async () => {
    await exposedApi.capture.screenshot();
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('capture:screenshot');
  });

  it('capture.screenshotRegion invokes capture:screenshot-region with bounds', async () => {
    const bounds = { x: 0, y: 0, width: 800, height: 600 };
    await exposedApi.capture.screenshotRegion(bounds);
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('capture:screenshot-region', bounds);
  });

  it('capture.activeWindow invokes capture:active-window', async () => {
    await exposedApi.capture.activeWindow();
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('capture:active-window');
  });

  it('capture.selectRegion invokes capture:select-region', async () => {
    await exposedApi.capture.selectRegion();
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('capture:select-region');
  });

  it('capture.setRegion invokes capture:set-region with bounds', async () => {
    const bounds = { x: 10, y: 20, width: 400, height: 300 };
    await exposedApi.capture.setRegion(bounds);
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('capture:set-region', bounds);
  });

  it('capture.clearRegion invokes capture:clear-region', async () => {
    await exposedApi.capture.clearRegion();
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('capture:clear-region');
  });

  it('capture.getDisplays invokes capture:getDisplays', async () => {
    await exposedApi.capture.getDisplays();
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('capture:getDisplays');
  });

  it('capture.setActiveDisplay invokes capture:setActiveDisplay with id', async () => {
    await exposedApi.capture.setActiveDisplay(2);
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('capture:setActiveDisplay', 2);
  });

  it('capture.setFollowActiveWindow invokes with boolean', async () => {
    await exposedApi.capture.setFollowActiveWindow(true);
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('capture:setFollowActiveWindow', true);
  });
});

describe('preload — recording namespace', () => {
  beforeEach(() => mockIpcRenderer.invoke.mockClear());

  it('recording.start invokes recording:start with mode', async () => {
    await exposedApi.recording.start('screen');
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('recording:start', 'screen');
  });

  it('recording.stop invokes recording:stop', async () => {
    await exposedApi.recording.stop();
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('recording:stop');
  });

  it('recording.addStep invokes recording:add-step with step data', async () => {
    const stepData = { notes: 'Checked inventory', resource: 'Forklift' };
    await exposedApi.recording.addStep(stepData);
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('recording:add-step', stepData);
  });

  it('recording.getStatus invokes recording:get-status', async () => {
    await exposedApi.recording.getStatus();
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('recording:get-status');
  });

  it('recording.delete invokes recording:delete with path', async () => {
    await exposedApi.recording.delete('/path/to/session');
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('recording:delete', '/path/to/session');
  });

  it('recording.onStatusChanged registers ipcRenderer.on listener', () => {
    const cb = jest.fn();
    exposedApi.recording.onStatusChanged(cb);
    expect(mockIpcRenderer.on).toHaveBeenCalledWith('recording:status-changed', expect.any(Function));
  });

  it('recording.onNewStep registers shortcut:new-step listener', () => {
    const cb = jest.fn();
    exposedApi.recording.onNewStep(cb);
    expect(mockIpcRenderer.on).toHaveBeenCalledWith('shortcut:new-step', expect.any(Function));
  });

  it('recording.onStopShortcut registers shortcut:stop listener', () => {
    const cb = jest.fn();
    exposedApi.recording.onStopShortcut(cb);
    expect(mockIpcRenderer.on).toHaveBeenCalledWith('shortcut:stop', expect.any(Function));
  });
});

describe('preload — sync namespace', () => {
  beforeEach(() => mockIpcRenderer.invoke.mockClear());

  it('sync.upload invokes sync:upload with data', async () => {
    const data = { mapId: '1', recording: {} };
    await exposedApi.sync.upload(data);
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('sync:upload', data);
  });

  it('sync.testConnection invokes sync:test-connection', async () => {
    await exposedApi.sync.testConnection();
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('sync:test-connection');
  });

  it('sync.getMaps invokes sync:get-maps', async () => {
    await exposedApi.sync.getMaps();
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('sync:get-maps');
  });

  it('sync.getMapRuns invokes sync:get-map-runs with mapId', async () => {
    await exposedApi.sync.getMapRuns('map_42');
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('sync:get-map-runs', 'map_42');
  });

  it('sync.getStats invokes sync:get-stats', async () => {
    await exposedApi.sync.getStats();
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('sync:get-stats');
  });

  it('sync.request invokes sync:request with apiPath', async () => {
    await exposedApi.sync.request('/live-recording/active');
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('sync:request', '/live-recording/active');
  });
});

describe('preload — settings namespace', () => {
  beforeEach(() => mockIpcRenderer.invoke.mockClear());

  it('settings.get invokes settings:get', async () => {
    await exposedApi.settings.get();
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('settings:get');
  });

  it('settings.set invokes settings:set with settings object', async () => {
    const settings = { apiUrl: 'https://mapvs.com/api/v1', token: 'tok_x' };
    await exposedApi.settings.set(settings);
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('settings:set', settings);
  });

  it('settings.clearData invokes settings:clear-data', async () => {
    await exposedApi.settings.clearData();
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('settings:clear-data');
  });
});

describe('preload — app namespace', () => {
  beforeEach(() => mockIpcRenderer.invoke.mockClear());

  it('app.checkUpdate invokes app:check-update', async () => {
    await exposedApi.app.checkUpdate();
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('app:check-update');
  });

  it('app.installUpdate invokes app:install-update', async () => {
    await exposedApi.app.installUpdate();
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('app:install-update');
  });

  it('app.getVersion invokes app:get-version', async () => {
    await exposedApi.app.getVersion();
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('app:get-version');
  });

  it('app.onUpdateAvailable registers update:available listener', () => {
    const cb = jest.fn();
    exposedApi.app.onUpdateAvailable(cb);
    expect(mockIpcRenderer.on).toHaveBeenCalledWith('update:available', expect.any(Function));
  });

  it('app.onUpdateDownloaded registers update:downloaded listener', () => {
    const cb = jest.fn();
    exposedApi.app.onUpdateDownloaded(cb);
    expect(mockIpcRenderer.on).toHaveBeenCalledWith('update:downloaded', expect.any(Function));
  });
});
