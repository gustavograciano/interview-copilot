import { dialog, ipcMain, type BrowserWindow } from 'electron';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { IPC, type CodingMessage, type SolutionInfo } from '../shared/types';
import { getSettings, saveSettings, saveAPIKeys, getGroqKey, getAnthropicKey } from './store';
import { transcribe } from './whisper';
import { startAssistance, startCoding, startTranslation, translateLine, clearCodingSolution, resetConversation } from './claude';
import { loadSolution, reloadSolution, clearSolution, getSolutionInfo } from './solution';
import { captureScreen } from './screenCapture';
import { openLogDir } from './sessionLog';
import { typeText, cancelTyping } from './autoTyper';

export function registerIpcHandlers(
  getOverlayWin: () => BrowserWindow | null,
  getCodingWin: () => BrowserWindow | null,
  getSettingsWin: () => BrowserWindow | null
) {
  ipcMain.handle(IPC.GET_SETTINGS, () => getSettings());

  ipcMain.handle(IPC.SAVE_SETTINGS, (_e, patch) => saveSettings(patch));

  ipcMain.handle(IPC.SAVE_API_KEYS, (_e, keys) => {
    saveAPIKeys(keys);
  });

  ipcMain.handle(IPC.TEST_KEYS, async () => {
    const result: {
      groq: boolean;
      anthropic: boolean;
      groqError?: string;
      anthropicError?: string;
    } = { groq: false, anthropic: false };

    const groq = getGroqKey();
    if (!groq) {
      result.groqError = 'no key configured';
    } else {
      try {
        const r = await fetch('https://api.groq.com/openai/v1/models', {
          headers: { Authorization: `Bearer ${groq}` },
        });
        if (r.ok) {
          result.groq = true;
        } else {
          const body = await r.text().catch(() => '');
          result.groqError = `HTTP ${r.status}: ${body.slice(0, 200)}`;
        }
      } catch (err) {
        result.groqError = (err as Error).message;
      }
    }

    const ant = getAnthropicKey();
    if (!ant) {
      result.anthropicError = 'no key configured';
    } else {
      try {
        await new Anthropic({ apiKey: ant }).messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 4,
          messages: [{ role: 'user', content: 'ping' }],
        });
        result.anthropic = true;
      } catch (err) {
        result.anthropicError = (err as Error).message;
      }
    }
    return result;
  });

  ipcMain.handle(IPC.TRANSCRIBE, async (_e, payload: { audio: ArrayBuffer; mime: string }) => {
    return transcribe(payload.audio, payload.mime);
  });

  ipcMain.handle(IPC.ASSIST_START, async (_e, transcript: string) => {
    const win = getOverlayWin();
    if (!win) return;
    await startAssistance(transcript, win);
  });

  ipcMain.handle(IPC.TRANSLATE_START, async (_e, transcript: string) => {
    const win = getOverlayWin();
    if (!win) return;
    await startTranslation(transcript, win);
  });

  ipcMain.handle(IPC.TRANSLATE_LINE, async (_e, text: string) => {
    return translateLine(text);
  });

  ipcMain.handle(IPC.CODE_START, async (_e, history: CodingMessage[]) => {
    const win = getCodingWin();
    if (!win) return;
    await startCoding(history, win);
  });

  ipcMain.handle(IPC.CAPTURE_SCREEN, async () => {
    return captureScreen();
  });

  ipcMain.handle(IPC.OPEN_LOGS, async () => {
    return openLogDir();
  });

  ipcMain.handle(IPC.SET_TEST_CONTEXT, (_e, context: string) => {
    saveSettings({ activeTestContext: context });
    // Broadcast to both windows so they can show/hide the badge in sync.
    const send = (w: BrowserWindow | null) => {
      if (w && !w.isDestroyed()) w.webContents.send(IPC.TEST_CONTEXT_CHANGED, context);
    };
    send(getOverlayWin());
    send(getCodingWin());
  });

  ipcMain.handle(IPC.CLEAR_TEST_CONTEXT, () => {
    saveSettings({ activeTestContext: '' });
    clearCodingSolution();
    resetConversation();
    const send = (w: BrowserWindow | null) => {
      if (w && !w.isDestroyed()) w.webContents.send(IPC.TEST_CONTEXT_CHANGED, '');
    };
    send(getOverlayWin());
    send(getCodingWin());
  });

  // Referenced solution — badge sync mirrors the test-context pattern above,
  // but reaches the Settings window too. Errored infos are broadcast as well,
  // so every window shows the same state (e.g. "reload failed, previous load
  // still active") instead of silently diverging.
  const broadcastSolution = (info: SolutionInfo | null) => {
    const send = (w: BrowserWindow | null) => {
      if (w && !w.isDestroyed()) w.webContents.send(IPC.SOLUTION_CHANGED, info);
    };
    send(getOverlayWin());
    send(getCodingWin());
    send(getSettingsWin());
  };

  ipcMain.handle(IPC.SOLUTION_SET, async (_e, path: string) => {
    const info = await loadSolution(path);
    broadcastSolution(info);
    return info;
  });

  ipcMain.handle(IPC.SOLUTION_RELOAD, async () => {
    const info = await reloadSolution();
    broadcastSolution(info);
    return info;
  });

  ipcMain.handle(IPC.SOLUTION_CLEAR, () => {
    clearSolution();
    broadcastSolution(null);
  });

  ipcMain.handle(IPC.SOLUTION_GET, () => getSolutionInfo());

  ipcMain.handle(IPC.SOLUTION_BROWSE, async (_e, kind: 'file' | 'folder') => {
    const r = await dialog.showOpenDialog({
      title: kind === 'folder' ? 'Select the solution folder' : 'Select the solution file',
      properties: [kind === 'folder' ? 'openDirectory' : 'openFile'],
    });
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0];
  });

  ipcMain.handle(IPC.TYPE_START, async (_e, text: string) => {
    const settings = getSettings();
    const codingWin = getCodingWin();
    const send = (channel: string, payload: unknown) => {
      if (codingWin && !codingWin.isDestroyed()) {
        codingWin.webContents.send(channel, payload);
      }
    };
    await typeText({
      text,
      speed: settings.typingSpeed,
      startDelaySec: settings.typingStartDelaySec,
      lockToFocusedWindow: settings.typingLockToWindow,
      onCountdown: (sec) => send(IPC.TYPE_COUNTDOWN, sec),
      onProgress: (typed, total) => send(IPC.TYPE_PROGRESS, { typed, total }),
      onDone: (cancelled, reason) => send(IPC.TYPE_DONE, { cancelled, reason }),
    });
  });

  ipcMain.on(IPC.TYPE_CANCEL, () => {
    cancelTyping();
  });
}
