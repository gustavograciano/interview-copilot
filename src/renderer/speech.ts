// Streaming speech-to-text using the Chromium-built-in Web Speech API.
// Free, no API key, no audio leaves the renderer (sent to Google's STT service
// transparently by Chromium). Auto-restarts on silence to keep transcribing
// throughout the interview.

type SR = typeof globalThis extends { SpeechRecognition: infer T } ? T : never;

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}
interface SpeechRecognitionResult {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternative;
}
interface SpeechRecognitionResultList {
  length: number;
  [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}
interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message: string;
}
interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition?: { new (): SpeechRecognitionLike };
    webkitSpeechRecognition?: { new (): SpeechRecognitionLike };
  }
}

export type SpeechStatus = 'idle' | 'listening' | 'speech' | 'final';

export interface SpeechCallbacks {
  onInterim?: (text: string) => void;
  onFinal: (text: string) => void;
  onStatus?: (s: SpeechStatus) => void;
  onError?: (err: Error) => void;
}

export class SpeechCapture {
  private rec: SpeechRecognitionLike | null = null;
  private stopping = false;
  private cbs: SpeechCallbacks | null = null;

  static isSupported(): boolean {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  start(lang: string, cbs: SpeechCallbacks) {
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) {
      cbs.onError?.(new Error('Web Speech API not available in this Electron build'));
      return;
    }
    this.cbs = cbs;
    this.stopping = false;
    this.spawn(Ctor, lang);
  }

  private spawn(Ctor: { new (): SpeechRecognitionLike }, lang: string) {
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = lang;

    rec.onstart = () => this.cbs?.onStatus?.('listening');

    rec.onresult = (e: SpeechRecognitionEvent) => {
      let interim = '';
      let final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const t = r[0]?.transcript ?? '';
        if (r.isFinal) final += t;
        else interim += t;
      }
      if (interim) this.cbs?.onInterim?.(interim.trim());
      if (final.trim()) {
        this.cbs?.onStatus?.('final');
        this.cbs?.onFinal(final.trim());
      }
    };

    rec.onerror = (e: SpeechRecognitionErrorEvent) => {
      // 'no-speech' and 'aborted' are normal during long sessions; ignore.
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      this.cbs?.onError?.(new Error(`Speech: ${e.error} ${e.message ?? ''}`.trim()));
    };

    rec.onend = () => {
      // Chromium ends the recognition periodically (~60s) — restart unless user stopped.
      if (!this.stopping && this.cbs) {
        try {
          this.spawn(Ctor, lang);
        } catch (err) {
          this.cbs.onError?.(err as Error);
        }
      }
    };

    this.rec = rec;
    try {
      rec.start();
    } catch (err) {
      this.cbs?.onError?.(err as Error);
    }
  }

  stop() {
    this.stopping = true;
    if (this.rec) {
      try {
        this.rec.abort();
      } catch {
        /* ignore */
      }
    }
    this.rec = null;
    this.cbs = null;
  }
}
