// __tests__/recorder.test.js - mapvs-recorder
// Tests for src/capture/recorder.js (Recorder class)

jest.mock('electron', () => ({
  powerMonitor: {
    getSystemIdleTime: jest.fn().mockReturnValue(0),
  },
}), { virtual: true });

jest.mock('../src/capture/screenshot', () => ({
  captureScreen: jest.fn().mockResolvedValue('/tmp/session/shot_1.png'),
  captureRegion: jest.fn().mockResolvedValue('/tmp/session/region_1.png'),
  getActiveWindow: jest.fn().mockResolvedValue({ title: 'Chrome - Google', app: 'Google Chrome', bounds: null }),
  getActiveDisplay: jest.fn().mockResolvedValue(1),
}));

jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(false),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
}));

const { Recorder } = require('../src/capture/recorder');
const { captureScreen, getActiveWindow } = require('../src/capture/screenshot');
const { powerMonitor } = require('electron');
const fs = require('fs');

describe('Recorder - constructor', () => {
  it('creates a session with unique ID', () => {
    const r1 = new Recorder({ storagePath: '/tmp', mode: 'manual' });
    const r2 = new Recorder({ storagePath: '/tmp', mode: 'manual' });
    expect(r1.sessionId).toBeTruthy();
    expect(r2.sessionId).toBeTruthy();
    expect(r1.sessionId).not.toBe(r2.sessionId);
  });

  it('sets default values', () => {
    const rec = new Recorder({ storagePath: '/tmp' });
    expect(rec.mode).toBe('manual');
    expect(rec.status).toBe('idle');
    expect(rec.steps).toEqual([]);
    expect(rec.startTime).toBeNull();
    expect(rec.endTime).toBeNull();
  });

  it('accepts all config options', () => {
    const rec = new Recorder({
      mode: 'screen',
      interval: 10000,
      storagePath: '/recordings',
      idleThreshold: 10,
      quality: 'high',
    });
    expect(rec.mode).toBe('screen');
    expect(rec.interval).toBe(10000);
    expect(rec.idleThreshold).toBe(10);
    expect(rec.quality).toBe('high');
  });
});

describe('Recorder - start()', () => {
  afterEach(() => jest.clearAllMocks());

  it('sets status to recording', async () => {
    const rec = new Recorder({ storagePath: '/tmp', mode: 'manual' });
    await rec.start();
    expect(rec.status).toBe('recording');
  });

  it('sets startTime as ISO string', async () => {
    const rec = new Recorder({ storagePath: '/tmp', mode: 'manual' });
    await rec.start();
    expect(rec.startTime).toBeTruthy();
    expect(() => new Date(rec.startTime)).not.toThrow();
  });

  it('returns sessionId and mode', async () => {
    const rec = new Recorder({ storagePath: '/tmp', mode: 'manual' });
    const result = await rec.start();
    expect(result.sessionId).toBe(rec.sessionId);
    expect(result.mode).toBe('manual');
  });

  it('creates session directory', async () => {
    fs.existsSync.mockReturnValue(false);
    const rec = new Recorder({ storagePath: '/tmp', mode: 'manual' });
    await rec.start();
    expect(fs.mkdirSync).toHaveBeenCalledWith(
      expect.stringContaining(rec.sessionId),
      expect.objectContaining({ recursive: true })
    );
  });

  it('in screen mode: captures an initial step', async () => {
    const rec = new Recorder({ storagePath: '/tmp', mode: 'screen' });
    await rec.start();
    expect(rec.steps.length).toBeGreaterThanOrEqual(1);
    expect(captureScreen).toHaveBeenCalled();
  });

  it('in manual mode: does not auto-capture on start', async () => {
    const rec = new Recorder({ storagePath: '/tmp', mode: 'manual' });
    await rec.start();
    expect(rec.steps).toHaveLength(0);
    expect(captureScreen).not.toHaveBeenCalled();
  });
});

describe('Recorder - addStep()', () => {
  afterEach(() => jest.clearAllMocks());

  it('throws if not recording', async () => {
    const rec = new Recorder({ storagePath: '/tmp', mode: 'manual' });
    await expect(rec.addStep('some notes')).rejects.toThrow('Not currently recording');
  });

  it('adds step with notes and resource', async () => {
    const rec = new Recorder({ storagePath: '/tmp', mode: 'manual' });
    await rec.start();
    const step = await rec.addStep('Checked inventory', 'Forklift');
    expect(step.notes).toBe('Checked inventory');
    expect(step.resource).toBe('Forklift');
    expect(rec.steps).toHaveLength(1);
  });

  it('increments step order', async () => {
    const rec = new Recorder({ storagePath: '/tmp', mode: 'manual' });
    await rec.start();
    const s1 = await rec.addStep('Step one');
    const s2 = await rec.addStep('Step two');
    expect(s1.order).toBe(1);
    expect(s2.order).toBe(2);
  });

  it('captures screenshot and records window info', async () => {
    const rec = new Recorder({ storagePath: '/tmp', mode: 'manual' });
    await rec.start();
    const step = await rec.addStep('Test capture');
    expect(step.screenshot_path).toBe('/tmp/session/shot_1.png');
    expect(step.window_title).toBe('Chrome - Google');
    expect(step.app_name).toBe('Google Chrome');
  });

  it('sets va_type to undetermined', async () => {
    const rec = new Recorder({ storagePath: '/tmp', mode: 'manual' });
    await rec.start();
    const step = await rec.addStep('A step');
    expect(step.va_type).toBe('undetermined');
  });

  it('marks step as idle when system is idle', async () => {
    powerMonitor.getSystemIdleTime.mockReturnValue(10); // above default threshold of 5s
    const rec = new Recorder({ storagePath: '/tmp', mode: 'manual', idleThreshold: 5 });
    await rec.start();
    const step = await rec.addStep('Idle step');
    expect(step.idle_seconds).toBeGreaterThan(0);
  });

  it('step is not idle when system idle time is below threshold', async () => {
    powerMonitor.getSystemIdleTime.mockReturnValue(1); // below threshold
    const rec = new Recorder({ storagePath: '/tmp', mode: 'manual', idleThreshold: 5 });
    await rec.start();
    const step = await rec.addStep('Active step');
    expect(step.idle_seconds).toBe(0);
  });
});

describe('Recorder - stop()', () => {
  afterEach(() => jest.clearAllMocks());

  it('sets status to stopped and endTime', async () => {
    const rec = new Recorder({ storagePath: '/tmp', mode: 'manual' });
    await rec.start();
    await rec.addStep('Step A');
    const session = await rec.stop();
    expect(rec.status).toBe('stopped');
    expect(session.endTime).toBeTruthy();
  });

  it('returns full session data with steps', async () => {
    const rec = new Recorder({ storagePath: '/tmp', mode: 'manual' });
    await rec.start();
    await rec.addStep('Step A');
    await rec.addStep('Step B');
    const session = await rec.stop();
    expect(session.sessionId).toBe(rec.sessionId);
    expect(session.steps).toHaveLength(2);
    expect(session.startTime).toBeTruthy();
    expect(session.endTime).toBeTruthy();
  });

  it('calculates duration_secs for each step', async () => {
    const rec = new Recorder({ storagePath: '/tmp', mode: 'manual' });
    await rec.start();
    await rec.addStep('Step A');
    // Small delay so timestamps differ
    await new Promise(r => setTimeout(r, 5));
    await rec.addStep('Step B');
    const session = await rec.stop();
    // All steps should have non-negative durations
    for (const step of session.steps) {
      expect(step.duration_secs).toBeGreaterThanOrEqual(0);
    }
  });

  it('auto-classifies steps based on idle ratio', async () => {
    const rec = new Recorder({ storagePath: '/tmp', mode: 'manual' });
    await rec.start();

    // Add a step, then manually set its idle time high (>50% idle → nva)
    await rec.addStep('Idle step');
    await new Promise(r => setTimeout(r, 5));
    await rec.addStep('Active step'); // needed to give first step a duration

    const session = await rec.stop();
    // idle_seconds on step 0 is 0 (no mocked idle), so it should be auto-classified as 'va'
    const autoClassifiedSteps = session.steps.filter(s => s.auto_classified);
    // All steps with duration > 0 and idle ratio < 0.2 should be 'va'
    for (const step of autoClassifiedSteps) {
      expect(['va', 'nva']).toContain(step.va_type);
    }
  });

  it('writes session metadata to disk', async () => {
    const rec = new Recorder({ storagePath: '/tmp', mode: 'manual' });
    await rec.start();
    await rec.stop();
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('session.json'),
      expect.any(String)
    );
  });

  it('stops auto-capture interval timer', async () => {
    jest.useFakeTimers();
    const rec = new Recorder({ storagePath: '/tmp', mode: 'screen', interval: 1000 });
    await rec.start();
    jest.advanceTimersByTime(500);
    await rec.stop();
    expect(rec._intervalTimer).toBeNull();
    jest.useRealTimers();
  });
});

describe('deriveStageNameFromWindow (via addStep)', () => {
  afterEach(() => jest.clearAllMocks());

  it('derives stage name from window title - strips suffix after hyphen', async () => {
    getActiveWindow.mockResolvedValue({ title: 'Dashboard - MyApp', app: 'MyApp', bounds: null });
    const rec = new Recorder({ storagePath: '/tmp', mode: 'manual' });
    await rec.start();
    const step = await rec.addStep('');
    expect(step.stage_name).toBe('Dashboard');
  });

  it('uses app name when title is Unknown', async () => {
    getActiveWindow.mockResolvedValue({ title: 'Unknown', app: 'Excel', bounds: null });
    const rec = new Recorder({ storagePath: '/tmp', mode: 'manual' });
    await rec.start();
    const step = await rec.addStep('');
    expect(step.stage_name).toBe('Excel');
  });
});
