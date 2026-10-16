import { globalShortcut, type BrowserWindow } from 'electron';
import { IPC } from '../shared/types';
import { captureScreen } from './screenCapture';

export function registerHotkeys(
  getOverlayWin: () => BrowserWindow | null,
  openCoding: () => void,
  getCodingWin: () => BrowserWindow | null
) {
  globalShortcut.register('CommandOrControl+Shift+H', () => {
    const win = getOverlayWin();
    if (!win) return;
    if (win.isVisible()) win.hide();
    else win.show();
  });

  // Trigger / regenerate an answer for the question currently shown in the overlay.
  // The renderer holds the live transcript (including manual-mode captures), so we
  // just notify it and let it fire on its current state.
  globalShortcut.register('CommandOrControl+Shift+R', () => {
    const win = getOverlayWin();
    if (!win) return;
    win.webContents.send(IPC.ACTION_REGENERATE);
  });

  globalShortcut.register('CommandOrControl+Shift+C', () => {
    const win = getOverlayWin();
    if (!win) return;
    win.webContents.send(IPC.ACTION_COPY);
  });

  globalShortcut.register('CommandOrControl+Shift+K', () => {
    openCoding();
  });

  // Trigger the auto-typer with the last assistant response from the coding window.
  globalShortcut.register('CommandOrControl+Shift+T', () => {
    const win = getCodingWin();
    if (!win || win.isDestroyed()) return;
    win.webContents.send('action:type-last');
  });

  // Capture screen and inject it into the coding window as a new staged screenshot.
  globalShortcut.register('CommandOrControl+Shift+S', async () => {
    openCoding();
    // Give the window a moment to load if it was just opened.
    setTimeout(async () => {
      try {
        const capture = await captureScreen();
        const win = getCodingWin();
        if (win && !win.isDestroyed()) {
          win.webContents.send(IPC.SCREEN_CAPTURED, capture);
          win.show();
          win.focus();
        }
      } catch (err) {
        const win = getCodingWin();
        if (win && !win.isDestroyed()) {
          win.webContents.send(IPC.CODE_ERROR, `Screen capture failed: ${(err as Error).message}`);
        }
      }
    }, 200);
  });
}

export function unregisterHotkeys() {
  globalShortcut.unregisterAll();
}
