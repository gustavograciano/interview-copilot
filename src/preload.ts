import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type PreloadAPI } from './shared/types';

const api: PreloadAPI = {
  getSettings: () => ipcRenderer.invoke(IPC.GET_SETTINGS),
  saveSettings: (s) => ipcRenderer.invoke(IPC.SAVE_SETTINGS, s),
  saveAPIKeys: (k) => ipcRenderer.invoke(IPC.SAVE_API_KEYS, k),
  testKeys: () => ipcRenderer.invoke(IPC.TEST_KEYS),
  transcribe: (p) => ipcRenderer.invoke(IPC.TRANSCRIBE, p),
  startAssistance: (t) => ipcRenderer.invoke(IPC.ASSIST_START, t),
  startTranslation: (t) => ipcRenderer.invoke(IPC.TRANSLATE_START, t),
  translateLine: (t) => ipcRenderer.invoke(IPC.TRANSLATE_LINE, t),
  onAssistToken: (cb) => {
    const handler = (_e: unknown, p: { translation: string; response: string }) => cb(JSON.stringify(p));
    ipcRenderer.on(IPC.ASSIST_TOKEN, handler);
    return () => ipcRenderer.removeListener(IPC.ASSIST_TOKEN, handler);
  },
  onAssistDone: (cb) => {
    const handler = (_e: unknown, r: import('./shared/types').AssistanceResult) => cb(r);
    ipcRenderer.on(IPC.ASSIST_DONE, handler);
    return () => ipcRenderer.removeListener(IPC.ASSIST_DONE, handler);
  },
  onAssistError: (cb) => {
    const handler = (_e: unknown, msg: string) => cb(msg);
    ipcRenderer.on(IPC.ASSIST_ERROR, handler);
    return () => ipcRenderer.removeListener(IPC.ASSIST_ERROR, handler);
  },
  onTranslateToken: (cb) => {
    const handler = (_e: unknown, t: string) => cb(t);
    ipcRenderer.on(IPC.TRANSLATE_TOKEN, handler);
    return () => ipcRenderer.removeListener(IPC.TRANSLATE_TOKEN, handler);
  },
  onTranslateDone: (cb) => {
    const handler = (_e: unknown, t: string) => cb(t);
    ipcRenderer.on(IPC.TRANSLATE_DONE, handler);
    return () => ipcRenderer.removeListener(IPC.TRANSLATE_DONE, handler);
  },
  startCoding: (history) => ipcRenderer.invoke(IPC.CODE_START, history),
  onCodingToken: (cb) => {
    const handler = (_e: unknown, t: string) => cb(t);
    ipcRenderer.on(IPC.CODE_TOKEN, handler);
    return () => ipcRenderer.removeListener(IPC.CODE_TOKEN, handler);
  },
  onCodingDone: (cb) => {
    const handler = (_e: unknown, t: string) => cb(t);
    ipcRenderer.on(IPC.CODE_DONE, handler);
    return () => ipcRenderer.removeListener(IPC.CODE_DONE, handler);
  },
  onCodingError: (cb) => {
    const handler = (_e: unknown, msg: string) => cb(msg);
    ipcRenderer.on(IPC.CODE_ERROR, handler);
    return () => ipcRenderer.removeListener(IPC.CODE_ERROR, handler);
  },
  captureScreen: () => ipcRenderer.invoke(IPC.CAPTURE_SCREEN),
  onScreenCaptured: (cb) => {
    const handler = (_e: unknown, payload: { data: string; mediaType: string }) => cb(payload);
    ipcRenderer.on(IPC.SCREEN_CAPTURED, handler);
    return () => ipcRenderer.removeListener(IPC.SCREEN_CAPTURED, handler);
  },
  onAction: (channel, cb) => {
    const ch = channel === 'regenerate' ? IPC.ACTION_REGENERATE : IPC.ACTION_COPY;
    const handler = () => cb();
    ipcRenderer.on(ch, handler);
    return () => ipcRenderer.removeListener(ch, handler);
  },
  openSettings: () => ipcRenderer.send(IPC.OPEN_SETTINGS),
  openOverlay: () => ipcRenderer.send(IPC.OPEN_OVERLAY),
  openCoding: () => ipcRenderer.send(IPC.OPEN_CODING),
  openLogs: () => ipcRenderer.invoke(IPC.OPEN_LOGS),
  setTestContext: (context) => ipcRenderer.invoke(IPC.SET_TEST_CONTEXT, context),
  clearTestContext: () => ipcRenderer.invoke(IPC.CLEAR_TEST_CONTEXT),
  onTestContextChanged: (cb) => {
    const handler = (_e: unknown, context: string) => cb(context);
    ipcRenderer.on(IPC.TEST_CONTEXT_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC.TEST_CONTEXT_CHANGED, handler);
  },
  setSolutionPath: (path) => ipcRenderer.invoke(IPC.SOLUTION_SET, path),
  reloadSolution: () => ipcRenderer.invoke(IPC.SOLUTION_RELOAD),
  clearSolution: () => ipcRenderer.invoke(IPC.SOLUTION_CLEAR),
  getSolutionInfo: () => ipcRenderer.invoke(IPC.SOLUTION_GET),
  browseSolution: (kind) => ipcRenderer.invoke(IPC.SOLUTION_BROWSE, kind),
  onSolutionChanged: (cb) => {
    const handler = (_e: unknown, info: import('./shared/types').SolutionInfo | null) => cb(info);
    ipcRenderer.on(IPC.SOLUTION_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC.SOLUTION_CHANGED, handler);
  },
  typeText: (text) => ipcRenderer.invoke(IPC.TYPE_START, text),
  cancelTyping: () => ipcRenderer.send(IPC.TYPE_CANCEL),
  onTypeCountdown: (cb) => {
    const handler = (_e: unknown, sec: number) => cb(sec);
    ipcRenderer.on(IPC.TYPE_COUNTDOWN, handler);
    return () => ipcRenderer.removeListener(IPC.TYPE_COUNTDOWN, handler);
  },
  onTypeProgress: (cb) => {
    const handler = (_e: unknown, p: { typed: number; total: number }) => cb(p);
    ipcRenderer.on(IPC.TYPE_PROGRESS, handler);
    return () => ipcRenderer.removeListener(IPC.TYPE_PROGRESS, handler);
  },
  onTypeDone: (cb) => {
    const handler = (_e: unknown, payload: { cancelled: boolean; reason?: 'user' | 'focus-lost' }) =>
      cb(payload);
    ipcRenderer.on(IPC.TYPE_DONE, handler);
    return () => ipcRenderer.removeListener(IPC.TYPE_DONE, handler);
  },
};

contextBridge.exposeInMainWorld('api', api);

// Bridge the global ⌃⇧T hotkey from main to a DOM event the Coding window listens to.
ipcRenderer.on('action:type-last', () => {
  window.dispatchEvent(new CustomEvent('coding-type-last'));
});
