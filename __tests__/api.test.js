// __tests__/api.test.js — mapvs-recorder
// Tests for src/sync/api.js
// Run: npm test

jest.mock('node-fetch');
jest.mock('form-data');
jest.mock('fs');

const fetch = require('node-fetch');
const FormData = require('form-data');
const fs = require('fs');
const {
  testConnection,
  getMaps,
  uploadRecording,
  createMapFromRecording,
  getTemplates,
  getNotificationCount,
  getNotifications,
  getStats,
  getMapPresence,
  apiRequest,
  getMapRuns,
} = require('../src/sync/api');

// ── Helper: create a mock Response ────────────────────────────────────────────
function mockResponse(ok, status, body) {
  return {
    ok,
    status,
    text: jest.fn().mockResolvedValue(typeof body === 'string' ? body : JSON.stringify(body)),
    json: jest.fn().mockResolvedValue(body),
  };
}

const TOKEN = 'vs_test_token';
const API_URL = 'https://mapvs.com/api/v1';

describe('testConnection', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns true when API responds ok', async () => {
    fetch.mockResolvedValue(mockResponse(true, 200, {}));
    const result = await testConnection(TOKEN, API_URL);
    expect(result).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      `${API_URL}/maps`,
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('returns false when API responds with error status', async () => {
    fetch.mockResolvedValue(mockResponse(false, 401, {}));
    const result = await testConnection(TOKEN, API_URL);
    expect(result).toBe(false);
  });

  it('returns false when fetch throws (network error)', async () => {
    fetch.mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await testConnection(TOKEN, API_URL);
    expect(result).toBe(false);
  });

  it('sends Authorization header with Bearer token', async () => {
    fetch.mockResolvedValue(mockResponse(true, 200, {}));
    await testConnection(TOKEN, API_URL);
    const [, options] = fetch.mock.calls[0];
    expect(options.headers['Authorization']).toBe(`Bearer ${TOKEN}`);
  });
});

describe('getMaps', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns maps array on success', async () => {
    const maps = [{ id: 1, name: 'Order Fulfillment' }, { id: 2, name: 'Patient Intake' }];
    fetch.mockResolvedValue(mockResponse(true, 200, { maps }));
    const result = await getMaps(TOKEN, API_URL);
    expect(result).toEqual(maps);
  });

  it('falls back to raw array if no maps wrapper', async () => {
    const rawMaps = [{ id: 3, name: 'Raw Map' }];
    fetch.mockResolvedValue(mockResponse(true, 200, rawMaps));
    const result = await getMaps(TOKEN, API_URL);
    expect(result).toEqual(rawMaps);
  });

  it('throws when response is not ok', async () => {
    fetch.mockResolvedValue(mockResponse(false, 403, 'Forbidden'));
    await expect(getMaps(TOKEN, API_URL)).rejects.toThrow('403');
  });

  it('includes Authorization header', async () => {
    fetch.mockResolvedValue(mockResponse(true, 200, []));
    await getMaps(TOKEN, API_URL);
    const [, options] = fetch.mock.calls[0];
    expect(options.headers['Authorization']).toBe(`Bearer ${TOKEN}`);
  });
});

describe('uploadRecording', () => {
  const mockRecording = {
    sessionId: 'sess_001',
    mode: 'manual',
    startTime: '2026-04-02T00:00:00Z',
    endTime: '2026-04-02T00:30:00Z',
    steps: [
      { order: 1, notes: 'Step 1', screenshot_path: null },
      { order: 2, notes: 'Step 2', screenshot_path: '/tmp/shot.png' },
    ],
  };

  beforeEach(() => {
    // FormData mock: simulate getHeaders()
    FormData.prototype.append = jest.fn();
    FormData.prototype.getHeaders = jest.fn().mockReturnValue({ 'content-type': 'multipart/form-data; boundary=xxx' });
    // fs.existsSync: return true only for the screenshot path
    fs.existsSync = jest.fn((p) => p === '/tmp/shot.png');
    fs.createReadStream = jest.fn().mockReturnValue('__stream__');
  });

  afterEach(() => jest.clearAllMocks());

  it('POSTs to /maps/:mapId/recordings', async () => {
    fetch.mockResolvedValue(mockResponse(true, 200, { map_id: '1', stages_created: 2 }));
    await uploadRecording(TOKEN, API_URL, '1', mockRecording);
    expect(fetch).toHaveBeenCalledWith(
      `${API_URL}/maps/1/recordings`,
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('appends screenshot file when screenshot_path exists', async () => {
    fetch.mockResolvedValue(mockResponse(true, 200, { map_id: '1', stages_created: 2 }));
    await uploadRecording(TOKEN, API_URL, '1', mockRecording);
    // FormData.append should have been called for the screenshot
    const appendCalls = FormData.prototype.append.mock.calls.map(c => c[0]);
    expect(appendCalls).toContain('screenshot_1');
  });

  it('skips screenshot when file does not exist', async () => {
    fetch.mockResolvedValue(mockResponse(true, 200, { map_id: '1', stages_created: 1 }));
    // Override: no files exist
    fs.existsSync = jest.fn().mockReturnValue(false);
    await uploadRecording(TOKEN, API_URL, '1', mockRecording);
    const appendCalls = FormData.prototype.append.mock.calls.map(c => c[0]);
    expect(appendCalls).not.toContain('screenshot_0');
    expect(appendCalls).not.toContain('screenshot_1');
  });

  it('throws on non-ok response', async () => {
    fetch.mockResolvedValue(mockResponse(false, 500, 'Server error'));
    await expect(uploadRecording(TOKEN, API_URL, '1', mockRecording)).rejects.toThrow('Upload failed');
  });

  it('returns parsed response body on success', async () => {
    const expected = { map_id: '42', stages_created: 3 };
    fetch.mockResolvedValue(mockResponse(true, 200, expected));
    const result = await uploadRecording(TOKEN, API_URL, '42', mockRecording);
    expect(result).toEqual(expected);
  });
});

describe('createMapFromRecording', () => {
  const mockRecording = {
    sessionId: 'sess_002',
    mode: 'screen',
    startTime: '2026-04-02T01:00:00Z',
    endTime: '2026-04-02T01:15:00Z',
    steps: [{ order: 1, notes: 'A', screenshot_path: null }],
  };

  beforeEach(() => {
    FormData.prototype.append = jest.fn();
    FormData.prototype.getHeaders = jest.fn().mockReturnValue({});
    fs.existsSync = jest.fn().mockReturnValue(false);
  });

  afterEach(() => jest.clearAllMocks());

  it('POSTs to /maps', async () => {
    fetch.mockResolvedValue(mockResponse(true, 200, { map_id: 'new_1' }));
    await createMapFromRecording(TOKEN, API_URL, 'My New Map', mockRecording);
    expect(fetch).toHaveBeenCalledWith(`${API_URL}/maps`, expect.objectContaining({ method: 'POST' }));
  });

  it('includes map name in recording metadata appended to form', async () => {
    fetch.mockResolvedValue(mockResponse(true, 200, { map_id: 'new_2' }));
    await createMapFromRecording(TOKEN, API_URL, 'Named Map', mockRecording);
    const firstAppend = FormData.prototype.append.mock.calls[0];
    const metadataStr = firstAppend[1];
    const metadata = JSON.parse(metadataStr);
    expect(metadata.name).toBe('Named Map');
  });

  it('throws on non-ok response', async () => {
    fetch.mockResolvedValue(mockResponse(false, 422, 'Unprocessable'));
    await expect(
      createMapFromRecording(TOKEN, API_URL, 'Bad Map', mockRecording)
    ).rejects.toThrow('Map creation failed');
  });
});

describe('getTemplates', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns templates array', async () => {
    const templates = [{ id: 'tmpl_1', name: 'Manufacturing', industry: 'Manufacturing', steps: [] }];
    fetch.mockResolvedValue(mockResponse(true, 200, { templates }));
    const result = await getTemplates(TOKEN, API_URL);
    expect(result).toEqual(templates);
  });

  it('throws on error response', async () => {
    fetch.mockResolvedValue(mockResponse(false, 404, 'Not found'));
    await expect(getTemplates(TOKEN, API_URL)).rejects.toThrow('404');
  });
});

describe('getNotificationCount', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns count from API', async () => {
    fetch.mockResolvedValue(mockResponse(true, 200, { count: 5 }));
    const result = await getNotificationCount(TOKEN, API_URL);
    expect(result).toBe(5);
  });

  it('returns 0 when API responds not-ok', async () => {
    fetch.mockResolvedValue(mockResponse(false, 403, {}));
    const result = await getNotificationCount(TOKEN, API_URL);
    expect(result).toBe(0);
  });

  it('returns 0 on fetch error', async () => {
    fetch.mockRejectedValue(new Error('Network failure'));
    const result = await getNotificationCount(TOKEN, API_URL);
    expect(result).toBe(0);
  });
});

describe('getStats', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns stats from API', async () => {
    fetch.mockResolvedValue(mockResponse(true, 200, { total_maps: 12 }));
    const result = await getStats(TOKEN, API_URL);
    expect(result.total_maps).toBe(12);
  });

  it('falls back to maps count when stats endpoint fails', async () => {
    // First call (stats) fails, second call (maps) succeeds
    fetch
      .mockResolvedValueOnce(mockResponse(false, 404, 'Not Found'))
      .mockResolvedValueOnce(mockResponse(true, 200, [{ id: 1 }, { id: 2 }]));
    const result = await getStats(TOKEN, API_URL);
    expect(result.total_maps).toBe(2);
  });

  it('returns zero total_maps on network error', async () => {
    fetch.mockRejectedValue(new Error('ENOTFOUND'));
    const result = await getStats(TOKEN, API_URL);
    expect(result.total_maps).toBe(0);
  });
});

describe('getMapPresence', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns presence data unwrapped from API wrapper', async () => {
    const presence = { active_users: [{ user_id: 1, user_name: 'Alice' }], count: 1 };
    fetch.mockResolvedValue(mockResponse(true, 200, { status: 'ok', data: presence }));
    const result = await getMapPresence(TOKEN, API_URL, 'map_7');
    expect(result).toEqual(presence);
  });

  it('returns empty presence on error', async () => {
    fetch.mockRejectedValue(new Error('Timeout'));
    const result = await getMapPresence(TOKEN, API_URL, 'map_7');
    expect(result).toEqual({ active_users: [], count: 0 });
  });
});

describe('apiRequest', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns unwrapped data when API wrapper present', async () => {
    const data = { session_id: 'abc', status: 'active' };
    fetch.mockResolvedValue(mockResponse(true, 200, { status: 'ok', data }));
    const result = await apiRequest(TOKEN, API_URL, '/live-recording/active');
    expect(result).toEqual(data);
  });

  it('returns raw data when no wrapper', async () => {
    const data = [1, 2, 3];
    fetch.mockResolvedValue(mockResponse(true, 200, data));
    const result = await apiRequest(TOKEN, API_URL, '/some/path');
    expect(result).toEqual(data);
  });

  it('throws on non-ok response', async () => {
    fetch.mockResolvedValue(mockResponse(false, 403, 'Forbidden'));
    await expect(apiRequest(TOKEN, API_URL, '/restricted')).rejects.toThrow('API request failed');
  });
});

describe('getMapRuns', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns runs array', async () => {
    const runs = [{ id: 'run_1', label: 'Morning' }];
    fetch.mockResolvedValue(mockResponse(true, 200, { runs }));
    const result = await getMapRuns(TOKEN, API_URL, 'map_5');
    expect(result).toEqual(runs);
  });

  it('throws on error', async () => {
    fetch.mockResolvedValue(mockResponse(false, 500, 'Error'));
    await expect(getMapRuns(TOKEN, API_URL, 'map_5')).rejects.toThrow('Failed to fetch runs');
  });
});
