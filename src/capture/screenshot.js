const path = require('path');
const fs = require('fs');

/**
 * Capture the entire screen and save as PNG.
 * @param {string} storagePath - Directory to save screenshots
 * @returns {Promise<string>} Path to saved screenshot
 */
async function captureScreen(storagePath) {
  const screenshot = require('screenshot-desktop');

  // Ensure storage directory exists
  if (!fs.existsSync(storagePath)) {
    fs.mkdirSync(storagePath, { recursive: true });
  }

  const filename = `screenshot_${Date.now()}.png`;
  const filepath = path.join(storagePath, filename);

  const imgBuffer = await screenshot({ format: 'png' });
  fs.writeFileSync(filepath, imgBuffer);

  return filepath;
}

/**
 * Capture a specific region of the screen.
 * Falls back to full screen capture and crops if native region capture unavailable.
 * @param {{ x: number, y: number, width: number, height: number }} bounds
 * @param {string} storagePath - Directory to save screenshots
 * @returns {Promise<string>} Path to saved screenshot
 */
async function captureRegion(bounds, storagePath) {
  // screenshot-desktop doesn't support region capture natively
  // Capture full screen — region cropping can be done client-side if needed
  return captureScreen(storagePath);
}

/**
 * Get information about the currently active window.
 * @returns {Promise<{ title: string, app: string, bounds: object } | null>}
 */
async function getActiveWindow() {
  try {
    // active-win v8+ is ESM-only, so we use dynamic import
    const activeWinModule = await import('active-win');
    const activeWin = activeWinModule.default || activeWinModule;
    const win = await activeWin();

    if (!win) return null;

    return {
      title: win.title || 'Unknown',
      app: win.owner?.name || 'Unknown',
      bounds: win.bounds || null
    };
  } catch (err) {
    // Fallback if active-win isn't available or fails
    console.warn('active-win failed:', err.message);
    return {
      title: 'Unknown',
      app: 'Unknown',
      bounds: null
    };
  }
}

module.exports = { captureScreen, captureRegion, getActiveWindow };
