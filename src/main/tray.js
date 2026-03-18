const { Tray, Menu, nativeImage } = require('electron');
const path = require('path');

let tray = null;
let currentStatus = 'idle';

function createTrayIcon(status) {
  // Create a simple colored circle as tray icon
  // In production, use proper icon files from assets/
  const size = 22;
  const canvas = `
    <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${size/2}" cy="${size/2}" r="${size/2 - 2}"
        fill="${status === 'recording' ? '#ef4444' : status === 'syncing' ? '#f59e0b' : '#2563eb'}" />
      ${status === 'recording' ? `<circle cx="${size/2}" cy="${size/2}" r="4" fill="white" />` : ''}
      ${status === 'idle' ? `<polygon points="9,6 9,16 17,11" fill="white" />` : ''}
      ${status === 'syncing' ? `<path d="M7,11 L11,7 L15,11 M11,7 L11,17" stroke="white" stroke-width="2" fill="none" />` : ''}
    </svg>
  `;

  // Use a template image for macOS
  try {
    const iconPath = path.join(__dirname, '../../assets/tray-icon.png');
    return nativeImage.createFromPath(iconPath);
  } catch {
    // Fallback: create empty image (tray still works, just no custom icon)
    return nativeImage.createEmpty();
  }
}

function setupTray(showWindowCallback, stopRecordingCallback) {
  const icon = createTrayIcon('idle');
  tray = new Tray(icon);
  tray.setToolTip('ValueStream Recorder');

  function updateMenu() {
    const isRecording = currentStatus === 'recording';
    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'ValueStream Recorder',
        enabled: false
      },
      { type: 'separator' },
      {
        label: 'Show Window',
        click: showWindowCallback
      },
      { type: 'separator' },
      {
        label: isRecording ? 'Stop Recording' : 'Start Recording',
        click: () => {
          showWindowCallback();
          if (isRecording) {
            stopRecordingCallback();
          }
        }
      },
      { type: 'separator' },
      {
        label: `Status: ${currentStatus.charAt(0).toUpperCase() + currentStatus.slice(1)}`,
        enabled: false
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          const { app } = require('electron');
          app.isQuitting = true;
          app.quit();
        }
      }
    ]);

    tray.setContextMenu(contextMenu);
  }

  updateMenu();

  tray.on('click', () => {
    showWindowCallback();
  });

  tray.updateStatus = (status) => {
    currentStatus = status;
    const tooltips = {
      idle: 'ValueStream Recorder',
      recording: 'ValueStream Recorder - Recording...',
      syncing: 'ValueStream Recorder - Syncing...'
    };
    tray.setToolTip(tooltips[status] || tooltips.idle);
    updateMenu();
  };

  return tray;
}

module.exports = { setupTray };
