import { keyboard, Key, getActiveWindow } from '@nut-tree-fork/nut-js';

// Human-like typing: small per-keystroke jitter, longer pauses at end-of-line,
// occasional "thinking" pauses. Goal is to defeat paste-event detection on
// assessment platforms while still being fast enough to be useful.

export type TypingSpeed = 'slow' | 'medium' | 'fast';

interface SpeedProfile {
  baseDelayMs: number; // average per-char delay
  jitterMs: number; // random ± jitter around base
  newlinePauseMs: [number, number]; // [min, max] extra pause on newline
  thinkPauseChance: number; // 0..1, chance of a longer "thinking" pause between lines
  thinkPauseMs: [number, number]; // [min, max] for thinking pauses
}

const PROFILES: Record<TypingSpeed, SpeedProfile> = {
  slow: {
    baseDelayMs: 120,
    jitterMs: 60,
    newlinePauseMs: [400, 800],
    thinkPauseChance: 0.18,
    thinkPauseMs: [800, 2200],
  },
  medium: {
    baseDelayMs: 70,
    jitterMs: 40,
    newlinePauseMs: [200, 500],
    thinkPauseChance: 0.1,
    thinkPauseMs: [500, 1400],
  },
  fast: {
    baseDelayMs: 35,
    jitterMs: 20,
    newlinePauseMs: [80, 200],
    thinkPauseChance: 0.04,
    thinkPauseMs: [200, 700],
  },
};

function rand(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface TypingState {
  cancelled: boolean;
  cancelReason?: 'user' | 'focus-lost';
}

let active: TypingState | null = null;

export function cancelTyping() {
  if (active) {
    active.cancelled = true;
    active.cancelReason = 'user';
  }
}

export interface TypeOptions {
  text: string;
  speed: TypingSpeed;
  startDelaySec: number; // countdown so the user can focus the target field
  lockToFocusedWindow: boolean; // abort if the focused window changes
  onCountdown?: (secondsRemaining: number) => void;
  onProgress?: (charsTyped: number, total: number) => void;
  onDone?: (cancelled: boolean, reason?: 'user' | 'focus-lost') => void;
}

async function safeGetActiveTitle(): Promise<string | null> {
  try {
    const w = await getActiveWindow();
    return await w.title;
  } catch {
    return null;
  }
}

// Splits a piece of text into pieces separated by '\n'. For each newline we
// will issue Return + Home so that the editor's auto-indent (if any) is
// neutralized before we type the next line's literal indent. This prevents the
// "everything walks 4-8 spaces to the right per line" effect users see when
// pasting code into smart editors.
export async function typeText(opts: TypeOptions): Promise<void> {
  if (active) {
    // Cancel any prior run first.
    active.cancelled = true;
    await sleep(50);
  }
  const state: TypingState = { cancelled: false };
  active = state;

  const profile = PROFILES[opts.speed];

  try {
    // Countdown so the user can switch focus to the target window/field.
    for (let s = opts.startDelaySec; s > 0; s--) {
      opts.onCountdown?.(s);
      await sleep(1000);
      if (state.cancelled) {
        opts.onDone?.(true, state.cancelReason);
        return;
      }
    }
    opts.onCountdown?.(0);

    // Capture the target window AFTER countdown ended — that's the window the
    // user actually clicked into.
    const targetTitle = opts.lockToFocusedWindow ? await safeGetActiveTitle() : null;

    // Lower the global auto-delay; we manage per-keystroke timing ourselves.
    keyboard.config.autoDelayMs = 0;

    const text = opts.text;
    const total = text.length;
    let lineCharsSinceThink = 0;
    let charsSinceFocusCheck = 0;
    const FOCUS_CHECK_EVERY_CHARS = 25;

    for (let i = 0; i < total; i++) {
      if (state.cancelled) break;

      // Periodically verify the focused window hasn't changed. We check less
      // often than every keystroke because getActiveWindow() is slow on Windows.
      if (targetTitle !== null && charsSinceFocusCheck >= FOCUS_CHECK_EVERY_CHARS) {
        const nowTitle = await safeGetActiveTitle();
        if (nowTitle !== null && nowTitle !== targetTitle) {
          state.cancelled = true;
          state.cancelReason = 'focus-lost';
          break;
        }
        charsSinceFocusCheck = 0;
      }
      charsSinceFocusCheck++;

      const ch = text[i];

      if (ch === '\n') {
        // Press Enter (Return) as a real keystroke, not a typed char.
        await keyboard.pressKey(Key.Return);
        await keyboard.releaseKey(Key.Return);
        // Neutralize editor auto-indent: jump cursor to column 0 BEFORE typing
        // the next line's literal indent. Pressing Home twice handles both
        // editors that go to first-non-ws on first Home (VS Code, IntelliJ)
        // and editors that go directly to column 0 (Notepad, plain textareas).
        await keyboard.pressKey(Key.Home);
        await keyboard.releaseKey(Key.Home);
        await sleep(15);
        await keyboard.pressKey(Key.Home);
        await keyboard.releaseKey(Key.Home);
        await sleep(rand(profile.newlinePauseMs[0], profile.newlinePauseMs[1]));
        lineCharsSinceThink = 0;
        if (Math.random() < profile.thinkPauseChance) {
          await sleep(rand(profile.thinkPauseMs[0], profile.thinkPauseMs[1]));
        }
      } else if (ch === '\t') {
        await keyboard.pressKey(Key.Tab);
        await keyboard.releaseKey(Key.Tab);
        await sleep(profile.baseDelayMs);
      } else {
        // Type a single character.
        await keyboard.type(ch);
        const jitter = rand(-profile.jitterMs, profile.jitterMs);
        await sleep(Math.max(5, profile.baseDelayMs + jitter));
        lineCharsSinceThink++;
        // Mid-line, very rarely, also throw in a brief pause.
        if (lineCharsSinceThink > 30 && Math.random() < 0.02) {
          await sleep(rand(200, 600));
          lineCharsSinceThink = 0;
        }
      }
      opts.onProgress?.(i + 1, total);
    }
  } finally {
    opts.onDone?.(state.cancelled, state.cancelReason);
    if (active === state) active = null;
  }
}
