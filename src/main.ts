import { app, BrowserWindow, ipcMain, session } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { registerIpcHandlers } from './main/ipc';
import { registerHotkeys, unregisterHotkeys } from './main/hotkeys';
import { initSolutionFromStore, getSolutionInfo } from './main/solution';
import { IPC } from './shared/types';

if (started) app.quit();

// Set a friendly app name (shown in Windows app list, About dialogs, etc.).
app.setName('Interview Copilot');

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

let overlayWin: BrowserWindow | null = null;
let settingsWin: BrowserWindow | null = null;
let codingWin: BrowserWindow | null = null;

function loadRoute(win: BrowserWindow, route: string) {
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    win.loadURL(`${MAIN_WINDOW_VITE_DEV_SERVER_URL}#${route}`);
  } else {
    win.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`), {
      hash: route,
    });
  }
}

function createOverlay() {
  if (overlayWin && !overlayWin.isDestroyed()) {
    overlayWin.show();
    overlayWin.focus();
    return;
  }
  overlayWin = new BrowserWindow({
    title: 'Interview Copilot',
    width: 760,
    height: 820,
    minWidth: 420,
    minHeight: 580,
    x: 20,
    y: 80,
    transparent: true,
    alwaysOnTop: true,
    frame: false,
    skipTaskbar: true,
    resizable: true,
    backgroundColor: '#00000000',
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Hide from screen capture / screen share — defense layer #1.
  overlayWin.setContentProtection(true);
  overlayWin.setAlwaysOnTop(true, 'screen-saver');

  loadRoute(overlayWin, '/overlay');

  overlayWin.on('closed', () => {
    overlayWin = null;
  });
}

function createCoding() {
  if (codingWin && !codingWin.isDestroyed()) {
    codingWin.show();
    codingWin.focus();
    return;
  }
  codingWin = new BrowserWindow({
    width: 720,
    height: 800,
    title: 'Interview Copilot — Live Coding',
    backgroundColor: '#0f1115',
    skipTaskbar: true,
    alwaysOnTop: true,
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // Hide from screen capture / share — same as overlay.
  codingWin.setContentProtection(true);
  // Pin above everything else (including fullscreen apps and screen-share toolbars).
  codingWin.setAlwaysOnTop(true, 'screen-saver');
  codingWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  loadRoute(codingWin, '/coding');
  codingWin.on('closed', () => {
    codingWin = null;
  });
}

function createSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 720,
    height: 760,
    title: 'Interview Copilot — Settings',
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  loadRoute(settingsWin, '/settings');
  settingsWin.on('closed', () => {
    settingsWin = null;
  });
}

app.whenReady().then(() => {
  // Allow microphone access from renderer (otherwise getUserMedia fails silently).
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(permission === 'media' || permission === 'mediaKeySystem');
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
    return permission === 'media' || permission === 'mediaKeySystem';
  });

  registerIpcHandlers(() => overlayWin, () => codingWin, () => settingsWin);
  registerHotkeys(() => overlayWin, () => createCoding(), () => codingWin);

  ipcMain.on(IPC.OPEN_SETTINGS, () => createSettings());
  ipcMain.on(IPC.OPEN_OVERLAY, () => createOverlay());
  ipcMain.on(IPC.OPEN_CODING, () => createCoding());

  createOverlay();
  // Auto-open settings on first launch if no keys configured
  // (we infer via the settings IPC inside the renderer)
  createSettings();

  // Re-read the referenced solution from disk AFTER the windows exist so a
  // slow path (network share, big folder) never delays startup, then push the
  // result to whatever windows are already open (their mount-time fetch may
  // have run before the load finished).
  void initSolutionFromStore().then(() => {
    const solInfo = getSolutionInfo();
    if (!solInfo) return;
    for (const w of [overlayWin, codingWin, settingsWin]) {
      if (w && !w.isDestroyed()) w.webContents.send(IPC.SOLUTION_CHANGED, solInfo);
    }
  });
});

app.on('will-quit', () => {
  unregisterHotkeys();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
