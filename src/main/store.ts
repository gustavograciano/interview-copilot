import Store from 'electron-store';
import { safeStorage } from 'electron';
import type { AnswerLength, AppSettings, InterviewLanguage, InterviewStyle, ModelOption, ToneOption, TriggerMode, TypingSpeed } from '../shared/types';

interface PersistedShape {
  resume: string;
  jobDescription: string;
  vocabularyHints: string;
  examples: string;
  hrExamples: string;
  hrPreparedQuestions: AppSettings['hrPreparedQuestions'];
  technicalPreparedQuestions: AppSettings['technicalPreparedQuestions'];
  recruiterContext: string;
  employmentSituation: string;
  noticePeriod: string;
  weeklyAvailability: string;
  showTranslation: boolean;
  answerLength: AnswerLength;
  triggerMode: TriggerMode;
  typingSpeed: TypingSpeed;
  typingStartDelaySec: number;
  typingLockToWindow: boolean;
  interviewStyle: InterviewStyle;
  interviewLanguage: InterviewLanguage;
  activeTestContext: string;
  solutionPath: string;
  tone: ToneOption;
  model: ModelOption;
  audioDeviceId: string;
  overlayOpacity: number;
  overlayPosition: { x: number; y: number };
  encryptedGroq?: string;
  encryptedAnthropic?: string;
}

const store = new Store<PersistedShape>({
  name: 'interview-copilot',
  defaults: {
    resume: '',
    jobDescription: '',
    vocabularyHints: '',
    examples: '',
    hrExamples: '',
    hrPreparedQuestions: [],
    technicalPreparedQuestions: [],
    recruiterContext: '',
    employmentSituation: '',
    noticePeriod: '',
    weeklyAvailability: '',
    showTranslation: false,
    answerLength: 'concise',
    triggerMode: 'auto',
    typingSpeed: 'medium',
    typingStartDelaySec: 3,
    typingLockToWindow: true,
    interviewStyle: 'technical',
    interviewLanguage: 'en',
    activeTestContext: '',
    solutionPath: '',
    tone: 'conversational',
    model: 'claude-haiku-4-5-20251001',
    audioDeviceId: '',
    overlayOpacity: 0.92,
    overlayPosition: { x: 20, y: 80 },
  },
});

export function getSettings(): AppSettings {
  return {
    resume: store.get('resume'),
    jobDescription: store.get('jobDescription'),
    vocabularyHints: store.get('vocabularyHints'),
    examples: store.get('examples'),
    hrExamples: store.get('hrExamples'),
    hrPreparedQuestions: store.get('hrPreparedQuestions'),
    technicalPreparedQuestions: store.get('technicalPreparedQuestions'),
    recruiterContext: store.get('recruiterContext'),
    employmentSituation: store.get('employmentSituation'),
    noticePeriod: store.get('noticePeriod'),
    weeklyAvailability: store.get('weeklyAvailability'),
    showTranslation: store.get('showTranslation'),
    answerLength: store.get('answerLength'),
    triggerMode: store.get('triggerMode'),
    typingSpeed: store.get('typingSpeed'),
    typingStartDelaySec: store.get('typingStartDelaySec'),
    typingLockToWindow: store.get('typingLockToWindow'),
    interviewStyle: store.get('interviewStyle'),
    interviewLanguage: store.get('interviewLanguage'),
    activeTestContext: store.get('activeTestContext'),
    solutionPath: store.get('solutionPath'),
    tone: store.get('tone'),
    model: store.get('model'),
    audioDeviceId: store.get('audioDeviceId'),
    overlayOpacity: store.get('overlayOpacity'),
    overlayPosition: store.get('overlayPosition'),
    hasGroqKey: !!store.get('encryptedGroq'),
    hasAnthropicKey: !!store.get('encryptedAnthropic'),
  };
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const allowed: (keyof PersistedShape)[] = [
    'resume',
    'jobDescription',
    'vocabularyHints',
    'examples',
    'hrExamples',
    'hrPreparedQuestions',
    'technicalPreparedQuestions',
    'recruiterContext',
    'employmentSituation',
    'noticePeriod',
    'weeklyAvailability',
    'showTranslation',
    'answerLength',
    'triggerMode',
    'typingSpeed',
    'typingStartDelaySec',
    'typingLockToWindow',
    'interviewStyle',
    'interviewLanguage',
    'activeTestContext',
    'solutionPath',
    'tone',
    'model',
    'audioDeviceId',
    'overlayOpacity',
    'overlayPosition',
  ];
  for (const key of allowed) {
    if (key in patch) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      store.set(key, (patch as any)[key]);
    }
  }
  return getSettings();
}

function encrypt(plain: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS keychain unavailable; cannot store API keys safely');
  }
  return safeStorage.encryptString(plain).toString('base64');
}

function decrypt(b64: string): string {
  return safeStorage.decryptString(Buffer.from(b64, 'base64'));
}

export function saveAPIKeys(keys: { groq?: string; anthropic?: string }) {
  if (typeof keys.groq === 'string') {
    if (keys.groq.trim()) store.set('encryptedGroq', encrypt(keys.groq.trim()));
    else store.delete('encryptedGroq');
  }
  if (typeof keys.anthropic === 'string') {
    if (keys.anthropic.trim()) store.set('encryptedAnthropic', encrypt(keys.anthropic.trim()));
    else store.delete('encryptedAnthropic');
  }
}

export function getGroqKey(): string | null {
  const enc = store.get('encryptedGroq');
  return enc ? decrypt(enc) : null;
}

export function getAnthropicKey(): string | null {
  const enc = store.get('encryptedAnthropic');
  return enc ? decrypt(enc) : null;
}
