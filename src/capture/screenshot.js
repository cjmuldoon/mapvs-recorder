const path = require('path');
const fs = require('fs');
const { nativeImage } = require('electron');

/**
 * Capture the entire screen and save as PNG.
 * @param {string} storagePath - Directory to save screenshots
 * @param {number} [displayId] - Optional display ID to capture a specific monitor
 * @returns {Promise<string>} Path to saved screenshot
 */
async function captureScreen(storagePath, displayId) {
  const screenshot = require('screenshot-desktop');

  // Ensure storage directory exists
  if (!fs.existsSync(storagePath)) {
    fs.mkdirSync(storagePath, { recursive: true });
  }

  const filename = `screenshot_${Date.now()}.png`;
  const filepath = path.join(storagePath, filename);

  const opts = { format: 'png' };
  if (displayId != null) {
    opts.screen = displayId;
  }

  const imgBuffer = await screenshot(opts);
  fs.writeFileSync(filepath, imgBuffer);

  return filepath;
}

/**
 * Capture a specific region of the screen and save as a cropped PNG.
 * Uses screenshot-desktop for full capture, then Electron's nativeImage.crop() to extract the region.
 * @param {{ x: number, y: number, width: number, height: number }} bounds - Screen coordinates
 * @param {string} storagePath - Directory to save screenshots
 * @returns {Promise<string>} Path to saved cropped screenshot
 */
async function captureRegion(bounds, storagePath) {
  const screenshot = require('screenshot-desktop');

  if (!bounds || !bounds.width || !bounds.height) {
    // No valid bounds — fall back to full screen
    return captureScreen(storagePath);
  }

  // Ensure storage directory exists
  if (!fs.existsSync(storagePath)) {
    fs.mkdirSync(storagePath, { recursive: true });
  }

  const filename = `region_${Date.now()}.png`;
  const filepath = path.join(storagePath, filename);

  // Capture the full screen as a buffer
  const imgBuffer = await screenshot({ format: 'png' });

  // Create a nativeImage from the full-screen buffer
  const fullImage = nativeImage.createFromBuffer(imgBuffer);
  const fullSize = fullImage.getSize();

  // Calculate the device pixel ratio scaling factor
  // screenshot-desktop captures at native resolution, so coordinates may need scaling
  const screenBounds = require('electron').screen.getPrimaryDisplay().bounds;
  const scaleFactor = fullSize.width / screenBounds.width;

  // Scale the bounds to match the actual image pixel dimensions
  const cropRect = {
    x: Math.max(0, Math.round(bounds.x * scaleFactor)),
    y: Math.max(0, Math.round(bounds.y * scaleFactor)),
    width: Math.min(Math.round(bounds.width * scaleFactor), fullSize.width),
    height: Math.min(Math.round(bounds.height * scaleFactor), fullSize.height)
  };

  // Clamp to image boundaries
  if (cropRect.x + cropRect.width > fullSize.width) {
    cropRect.width = fullSize.width - cropRect.x;
  }
  if (cropRect.y + cropRect.height > fullSize.height) {
    cropRect.height = fullSize.height - cropRect.y;
  }

  // Crop the image
  const croppedImage = fullImage.crop(cropRect);
  const croppedBuffer = croppedImage.toPNG();

  fs.writeFileSync(filepath, croppedBuffer);
  return filepath;
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

/**
 * Get all connected displays using Electron's screen API.
 * @returns {Array<{ id: number, label: string, bounds: { x: number, y: number, width: number, height: number }, isPrimary: boolean }>}
 */
function getDisplays() {
  const { screen } = require('electron');
  const displays = screen.getAllDisplays();
  const primaryId = screen.getPrimaryDisplay().id;

  return displays.map((display, index) => ({
    id: display.id,
    label: display.label || `Display ${index + 1}`,
    bounds: {
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height
    },
    isPrimary: display.id === primaryId
  }));
}

/**
 * Determine which display the active window is on by comparing window bounds to display bounds.
 * @returns {Promise<number|null>} The display ID, or null if it cannot be determined
 */
async function getActiveDisplay() {
  const { screen } = require('electron');
  const winInfo = await getActiveWindow();

  if (!winInfo || !winInfo.bounds) {
    // Fall back to primary display
    return screen.getPrimaryDisplay().id;
  }

  // Find which display the center of the window falls on
  const centerX = winInfo.bounds.x + (winInfo.bounds.width || 0) / 2;
  const centerY = winInfo.bounds.y + (winInfo.bounds.height || 0) / 2;

  const displays = screen.getAllDisplays();
  for (const display of displays) {
    const b = display.bounds;
    if (centerX >= b.x && centerX < b.x + b.width &&
        centerY >= b.y && centerY < b.y + b.height) {
      return display.id;
    }
  }

  // Default to primary if no match
  return screen.getPrimaryDisplay().id;
}

module.exports = { captureScreen, captureRegion, getActiveWindow, getDisplays, getActiveDisplay };
