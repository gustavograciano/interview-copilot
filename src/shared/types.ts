export type AppStatus = 'idle' | 'listening' | 'transcribing' | 'responding' | 'error';

export type ToneOption = 'formal' | 'conversational';

export type AnswerLength = 'cues' | 'concise' | 'balanced' | 'detailed';

export type TriggerMode = 'auto' | 'manual';

export type TypingSpeed = 'slow' | 'medium' | 'fast';

export type AppMode = 'interview' | 'listen';

export type InterviewStyle = 'technical' | 'hr';

export type InterviewLanguage = 'en' | 'pt' | 'es';

export const LANGUAGE_LABELS: Record<InterviewLanguage, string> = {
  en: 'English',
  pt: 'Português',
  es: 'Español',
};

// Full language name as used in prompts (the language the candidate speaks/answers in).
export const LANGUAGE_NAMES: Record<InterviewLanguage, string> = {
  en: 'English',
  pt: 'Brazilian Portuguese',
  es: 'Spanish',
};

export type ModelOption =
  | 'claude-haiku-4-5-20251001'
  | 'claude-sonnet-4-6'
  | 'claude-opus-4-7';

// Summary of the solution loaded from disk (file or folder the candidate
// already submitted to the company). Content itself stays in the main process;
// renderers only see this metadata.
export interface SolutionInfo {
  path: string;
  name: string;
  fileCount: number;
  totalChars: number;
  truncated: boolean;
  omittedFiles: number;
  loadedAt: string;
  error?: string;
}

export interface AppSettings {
  resume: string;
  jobDescription: string;
  vocabularyHints: string;
  examples: string;
  hrExamples: string;
  hrPreparedQuestions: import('./hrPreparation').HrQuestion[];
  recruiterContext: string;
  employmentSituation: string;
  noticePeriod: string;
  weeklyAvailability: string;
  solutionPath: string;
  showTranslation: boolean;
  answerLength: AnswerLength;
  triggerMode: TriggerMode;
  typingSpeed: TypingSpeed;
  typingStartDelaySec: number;
  typingLockToWindow: boolean;
  interviewStyle: InterviewStyle;
  interviewLanguage: InterviewLanguage;
  activeTestContext: string;
  tone: ToneOption;
  model: ModelOption;
  audioDeviceId: string;
  overlayOpacity: number;
  overlayPosition: { x: number; y: number };
  hasGroqKey: boolean;
  hasAnthropicKey: boolean;
}

export interface OverlayState {
  status: AppStatus;
  transcript: string;
  translation: string;
  suggestedResponse: string;
  latencyMs: number;
  error?: string;
}

export interface AssistanceResult {
  translation: string;
  response: string;
  latencyMs: number;
}

export const IPC = {
  GET_SETTINGS: 'settings:get',
  SAVE_SETTINGS: 'settings:save',
  SAVE_API_KEYS: 'settings:save-keys',
  TEST_KEYS: 'settings:test-keys',

  TRANSCRIBE: 'audio:transcribe',
  ASSIST_START: 'claude:start',
  ASSIST_TOKEN: 'claude:token',
  ASSIST_DONE: 'claude:done',
  ASSIST_ERROR: 'claude:error',
  TRANSLATE_START: 'claude:translate-start',
  TRANSLATE_TOKEN: 'claude:translate-token',
  TRANSLATE_DONE: 'claude:translate-done',
  TRANSLATE_LINE: 'claude:translate-line',
  CODE_START: 'claude:code-start',
  CODE_TOKEN: 'claude:code-token',
  CODE_DONE: 'claude:code-done',
  CODE_ERROR: 'claude:code-error',
  CAPTURE_SCREEN: 'screen:capture',
  SCREEN_CAPTURED: 'screen:captured',
  OPEN_LOGS: 'logs:open',
  SET_TEST_CONTEXT: 'test-context:set',
  CLEAR_TEST_CONTEXT: 'test-context:clear',
  TEST_CONTEXT_CHANGED: 'test-context:changed',
  SOLUTION_SET: 'solution:set',
  SOLUTION_RELOAD: 'solution:reload',
  SOLUTION_CLEAR: 'solution:clear',
  SOLUTION_GET: 'solution:get',
  SOLUTION_BROWSE: 'solution:browse',
  SOLUTION_CHANGED: 'solution:changed',
  TYPE_START: 'type:start',
  TYPE_CANCEL: 'type:cancel',
  TYPE_COUNTDOWN: 'type:countdown',
  TYPE_PROGRESS: 'type:progress',
  TYPE_DONE: 'type:done',

  ACTION_REGENERATE: 'action:regenerate',
  ACTION_COPY: 'action:copy',
  ACTION_TOGGLE_VISIBILITY: 'action:toggle-visibility',

  OPEN_SETTINGS: 'window:open-settings',
  OPEN_OVERLAY: 'window:open-overlay',
  OPEN_CODING: 'window:open-coding',
} as const;

export type CodingMessageContent =
  | string
  | Array<
      | { type: 'text'; text: string }
      | { type: 'image'; mediaType: string; data: string }
    >;

export interface CodingMessage {
  role: 'user' | 'assistant';
  content: CodingMessageContent;
}

export interface PreloadAPI {
  getSettings(): Promise<AppSettings>;
  saveSettings(s: Partial<AppSettings>): Promise<AppSettings>;
  saveAPIKeys(keys: { groq?: string; anthropic?: string }): Promise<void>;
  testKeys(): Promise<{
    groq: boolean;
    anthropic: boolean;
    groqError?: string;
    anthropicError?: string;
  }>;
  transcribe(payload: { audio: ArrayBuffer; mime: string }): Promise<string>;
  startAssistance(transcript: string): Promise<void>;
  startTranslation(transcript: string): Promise<void>;
  translateLine(text: string): Promise<string>;
  onAssistToken(cb: (chunk: string) => void): () => void;
  onAssistDone(cb: (r: AssistanceResult) => void): () => void;
  onAssistError(cb: (err: string) => void): () => void;
  onTranslateToken(cb: (translation: string) => void): () => void;
  onTranslateDone(cb: (translation: string) => void): () => void;
  startCoding(history: CodingMessage[]): Promise<void>;
  onCodingToken(cb: (chunk: string) => void): () => void;
  onCodingDone(cb: (full: string) => void): () => void;
  onCodingError(cb: (err: string) => void): () => void;
  captureScreen(): Promise<{ data: string; mediaType: string }>;
  onScreenCaptured(cb: (payload: { data: string; mediaType: string }) => void): () => void;
  onAction(channel: 'regenerate' | 'copy', cb: () => void): () => void;
  openSettings(): void;
  openOverlay(): void;
  openCoding(): void;
  openLogs(): Promise<string>;
  setTestContext(context: string): Promise<void>;
  clearTestContext(): Promise<void>;
  onTestContextChanged(cb: (context: string) => void): () => void;
  setSolutionPath(path: string): Promise<SolutionInfo>;
  reloadSolution(): Promise<SolutionInfo | null>;
  clearSolution(): Promise<void>;
  getSolutionInfo(): Promise<SolutionInfo | null>;
  browseSolution(kind: 'file' | 'folder'): Promise<string | null>;
  onSolutionChanged(cb: (info: SolutionInfo | null) => void): () => void;
  typeText(text: string): Promise<void>;
  cancelTyping(): void;
  onTypeCountdown(cb: (sec: number) => void): () => void;
  onTypeProgress(cb: (p: { typed: number; total: number }) => void): () => void;
  onTypeDone(cb: (payload: { cancelled: boolean; reason?: 'user' | 'focus-lost' }) => void): () => void;
}

declare global {
  interface Window {
    api: PreloadAPI;
  }
}
