# ValueStream Recorder by MapVS

Desktop application for capturing screen-based processes and syncing them to [MapVS.com](https://mapvs.com) for value stream mapping.

## Quick Start

```bash
npm install
npm start
```

## Build

```bash
npm run build:mac     # macOS (.dmg)
npm run build:win     # Windows (.exe)
npm run build:linux   # Linux (.AppImage)
```

## Architecture

```
src/
  main/           Electron main process, tray, IPC handlers
    main.js       App entry point, window management, IPC setup
    preload.js    Context bridge (secure IPC for renderer)
    tray.js       System tray icon and menu
  capture/        Screenshot and activity tracking
    screenshot.js Screen capture and active window detection
    recorder.js   Recording session manager (screen + manual modes)
  renderer/       UI (HTML/CSS/JS)
    index.html    Main window UI
    renderer.js   UI state management and IPC calls
    styles.css    Clarity theme styles
  sync/           MapVS.com API client
    api.js        REST API integration (upload, map CRUD)
```

## Recording Modes

**Screen Recording** — Automatically captures screenshots at a configurable interval (1s-30s). Detects window changes as potential step boundaries.

**Manual Step-through** — Capture each step on demand via button click or keyboard shortcut (Cmd+Shift+N). Add notes per step.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Cmd+Shift+N | Capture new step |
| Cmd+Shift+S | Stop recording |
