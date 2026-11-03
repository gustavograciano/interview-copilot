import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AudioCapture, type AudioStatus } from './audio';
import {
  LANGUAGE_LABELS,
  type AppMode,
  type AppSettings,
  type InterviewLanguage,
  type InterviewStyle,
  type OverlayState,
  type SolutionInfo,
} from '../shared/types';

import { HrPreparation } from './HrPreparation';
import { recruiterPreset } from '../shared/hrPreparation';
import './interview.css';

const LANGS: InterviewLanguage[] = ['en', 'pt', 'es'];

const STATUS_TEXT: Record<OverlayState['status'], string> = {
  idle: 'Idle',
  listening: '● LISTENING',
  transcribing: '◌ Transcribing…',
  responding: '◌ Generating…',
  error: '⚠ Error',
};

const STATUS_COLOR: Record<OverlayState['status'], string> = {
  idle: '#888',
  listening: '#22c55e',
  transcribing: '#f59e0b',
  responding: '#3b82f6',
  error: '#ef4444',
};

export function Overlay() {
  useEffect(() => {
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    return () => {
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    };
  }, []);

  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [state, setState] = useState<OverlayState>({
    status: 'idle',
    transcript: '',
    translation: '',
    suggestedResponse: '',
    latencyMs: 0,
  });
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [fontSize, setFontSize] = useState(20);
  const [presetBusy, setPresetBusy] = useState(false);
  const captureRef = useRef<AudioCapture | null>(null);
  const [level, setLevel] = useState(0);
  const [mode, setMode] = useState<AppMode>('interview');
  const modeRef = useRef<AppMode>('interview');
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  const [interviewStyle, setInterviewStyle] = useState<InterviewStyle>('technical');
  // Live answer/STT language. Kept in a ref too so the running capture loop reads
  // the CURRENT language (the toggle changes it mid-session, no restart).
  const [interviewLanguage, setInterviewLanguage] = useState<InterviewLanguage>('en');
  const langRef = useRef<InterviewLanguage>('en');
  useEffect(() => {
    langRef.current = interviewLanguage;
  }, [interviewLanguage]);
  const [testContext, setTestContextState] = useState('');
  const [solution, setSolution] = useState<SolutionInfo | null>(null);
  // De-dup guard: one utterance can be transcribed and submitted twice within a
  // few seconds. Track the last fired transcript + time to suppress near-dupes.
  const lastFiredRef = useRef<{ text: string; at: number }>({ text: '', at: 0 });

  // Live transcript log (Listen mode) — accumulates each captured line in real
  // time so the user can follow meetings/lectures. Capped to the last 500 lines.
  const [transcriptLog, setTranscriptLog] = useState<
    Array<{ id: number; time: string; text: string; translation: string }>
  >([]);
  const logIdRef = useRef(0);
  const logScrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Auto-scroll the transcript log to the newest line unless the user scrolled up.
  useEffect(() => {
    if (autoScroll && logScrollRef.current) {
      logScrollRef.current.scrollTop = logScrollRef.current.scrollHeight;
    }
  }, [transcriptLog, autoScroll]);

  const copyTranscript = useCallback(() => {
    const txt = transcriptLog
      .map((l) => (l.translation ? `${l.text}\n  ↳ ${l.translation}` : l.text))
      .join('\n');
    void navigator.clipboard.writeText(txt);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [transcriptLog]);

  const clearTranscript = useCallback(() => setTranscriptLog([]), []);

  // Subscribe to active-test-context updates from main / coding window.
  useEffect(() => {
    const off = window.api.onTestContextChanged((ctx) => setTestContextState(ctx));
    return off;
  }, []);

  // Referenced-solution badge: initial fetch + live updates from Settings.
  useEffect(() => {
    void window.api.getSolutionInfo().then(setSolution);
    const off = window.api.onSolutionChanged(setSolution);
    return off;
  }, []);

  const clearSolution = useCallback(() => {
    void window.api.clearSolution();
  }, []);

  // Persist interview-style changes immediately.
  const updateInterviewStyle = useCallback(
    (next: InterviewStyle) => {
      setInterviewStyle(next);
      void window.api.saveSettings({ interviewStyle: next });
    },
    []
  );

  // Live language switch — persists immediately. Because main reads getSettings()
  // per request and the capture loop reads langRef, the change takes effect on the
  // next answer with no restart.
  const updateInterviewLanguage = useCallback((next: InterviewLanguage) => {
    setInterviewLanguage(next);
    void window.api.saveSettings({ interviewLanguage: next });
  }, []);

  const clearTest = useCallback(() => {
    void window.api.clearTestContext();
  }, []);

  // Manual-trigger support: in manual mode we capture+display the question but
  // only generate when the user explicitly triggers (⌃⇧R or the Answer button).
  const [pending, setPending] = useState(false);
  const triggerRef = useRef<'auto' | 'manual'>('auto');
  const pendingSttRef = useRef<{ durationMs: number; sttMs: number } | null>(null);
  useEffect(() => {
    if (settings) triggerRef.current = settings.triggerMode;
  }, [settings]);

  // Latency breakdown for the last completed chunk.
  const [timings, setTimings] = useState<{
    audioMs: number; // duration of audio chunk
    sttMs: number; // whisper round-trip
    llmFirstTokenMs: number; // claude first-token after request
    llmTotalMs: number; // claude full response
  } | null>(null);
  const timingRef = useRef<{ sttStart: number; llmStart: number; llmFirstToken: number }>({
    sttStart: 0,
    llmStart: 0,
    llmFirstToken: 0,
  });

  // Load settings + re-fetch whenever overlay regains focus or visibility
  useEffect(() => {
    const refresh = () =>
      void window.api.getSettings().then((s) => {
        setSettings(s);
        setInterviewStyle(s.interviewStyle);
        setInterviewLanguage(s.interviewLanguage);
        setTestContextState(s.activeTestContext);
      });
    refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  // Subscribe to streaming tokens
  useEffect(() => {
    const offTok = window.api.onAssistToken((raw) => {
      if (timingRef.current.llmFirstToken === 0 && timingRef.current.llmStart > 0) {
        timingRef.current.llmFirstToken = performance.now();
      }
      const p = JSON.parse(raw) as { translation: string; response: string };
      setState((s) => ({
        ...s,
        translation: p.translation,
        suggestedResponse: p.response,
        status: 'responding',
      }));
    });
    const offDone = window.api.onAssistDone((r) => {
      const now = performance.now();
      const t = timingRef.current;
      setTimings((prev) => ({
        audioMs: prev?.audioMs ?? 0,
        sttMs: prev?.sttMs ?? 0,
        llmFirstTokenMs: t.llmFirstToken && t.llmStart ? t.llmFirstToken - t.llmStart : 0,
        llmTotalMs: t.llmStart ? now - t.llmStart : 0,
      }));
      console.log('[timing] full assist done', {
        firstTokenMs: Math.round(t.llmFirstToken - t.llmStart),
        totalMs: Math.round(now - t.llmStart),
      });
      setState((s) => ({
        ...s,
        translation: r.translation,
        suggestedResponse: r.response,
        latencyMs: r.latencyMs,
        status: 'listening',
      }));
    });
    const offErr = window.api.onAssistError((msg) => {
      setState((s) => ({ ...s, status: 'error', error: msg }));
    });
    const offTrTok = window.api.onTranslateToken((t) => {
      if (timingRef.current.llmFirstToken === 0 && timingRef.current.llmStart > 0) {
        timingRef.current.llmFirstToken = performance.now();
      }
      setState((s) => ({ ...s, translation: t, status: 'responding' }));
    });
    const offTrDone = window.api.onTranslateDone((t) => {
      const now = performance.now();
      const ts = timingRef.current;
      setTimings((prev) => ({
        audioMs: prev?.audioMs ?? 0,
        sttMs: prev?.sttMs ?? 0,
        llmFirstTokenMs: ts.llmFirstToken && ts.llmStart ? ts.llmFirstToken - ts.llmStart : 0,
        llmTotalMs: ts.llmStart ? now - ts.llmStart : 0,
      }));
      setState((s) => ({ ...s, translation: t, status: 'listening' }));
    });
    return () => {
      offTok();
      offDone();
      offErr();
      offTrTok();
      offTrDone();
    };
  }, []);

  // Hotkey actions — copy ONLY the spoken answer, never the reserve probe notes.
  const handleCopy = useCallback(() => {
    if (state.suggestedResponse) {
      const { spoken } = splitSpokenProbe(state.suggestedResponse);
      void navigator.clipboard.writeText(spoken || state.suggestedResponse);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [state.suggestedResponse]);

  // Keep the question, translation and response from the same turn together.
  const fireAnswer = useCallback((q: string) => {
    if (!q.trim()) return;
    setPending(false);
    setState((st) => ({ ...st, transcript: q, translation: '', suggestedResponse: '', error: undefined, status: 'responding' }));
    const p = pendingSttRef.current;
    setTimings({
      audioMs: p?.durationMs ?? 0,
      sttMs: p?.sttMs ?? 0,
      llmFirstTokenMs: 0,
      llmTotalMs: 0,
    });
    timingRef.current.llmStart = performance.now();
    if (modeRef.current === 'listen') void window.api.startTranslation(q);
    else void window.api.startAssistance(q);
  }, []);

  const handleRegenerate = useCallback(() => {
    if (state.transcript) fireAnswer(state.transcript);
  }, [state.transcript, fireAnswer]);

  useEffect(() => {
    const offCopy = window.api.onAction('copy', handleCopy);
    const offRegen = window.api.onAction('regenerate', handleRegenerate);
    return () => {
      offCopy();
      offRegen();
    };
  }, [handleCopy, handleRegenerate]);

  const start = useCallback(async () => {
    const fresh = await window.api.getSettings();
    setSettings(fresh);
    if (!fresh.hasAnthropicKey || !fresh.hasGroqKey) {
      setState((s) => ({
        ...s,
        status: 'error',
        error: 'Configure both Groq (STT) and Anthropic API keys in Settings first.',
      }));
      return;
    }
    setRunning(true);
    setAutoScroll(true);
    if (modeRef.current === 'listen') setTranscriptLog([]);
    setState({
      status: 'listening',
      transcript: '',
      translation: '',
      suggestedResponse: '',
      latencyMs: 0,
    });
    const cap = new AudioCapture();
    captureRef.current = cap;

    // Listen/transcript mode flushes faster so text appears in near real time;
    // interview modes keep the longer windows so whole questions arrive intact.
    const timing =
      modeRef.current === 'listen'
        ? { silenceMs: 700, maxChunkMs: 7000, minSpeechMs: 400 }
        : undefined;

    await cap.start(fresh.audioDeviceId, {
      onStatus: (s: AudioStatus) => {
        if (s === 'flushing') setState((st) => ({ ...st, status: 'transcribing' }));
        if (s === 'listening')
          setState((st) => (st.status === 'transcribing' ? { ...st, status: 'listening' } : st));
      },
      onChunk: async (blob, mime, durationMs) => {
        try {
          const buf = await blob.arrayBuffer();
          const sttStart = performance.now();
          timingRef.current = { sttStart, llmStart: 0, llmFirstToken: 0 };
          const text = await window.api.transcribe({ audio: buf, mime });
          const sttMs = Math.round(performance.now() - sttStart);
          // Strip STT garbage (hallucinated tech tokens from noise) and keep only
          // the readable speech — usually the real question buried at the end.
          // Language-agnostic: the question may be in any supported language,
          // independent of the answer language the candidate selected.
          const readable = extractReadableSpeech(text.trim());
          const cleaned = readable || text.trim();
          const wordCount = cleaned.split(/\s+/).filter((w) => /[\p{L}]/u.test(w)).length;
          console.log('[timing] stt', { audioMs: Math.round(durationMs), sttMs, raw: text, cleaned });
          // In Listen (live-transcript) mode keep filler too — a meeting/lecture
          // transcript should capture short utterances. In interview modes, drop
          // filler/backchannel so an "okay/thanks" never wipes the answer.
          const isListen = modeRef.current === 'listen';
          const dropFiller = !isListen && isMostlyFiller(cleaned);
          // If extractReadableSpeech found nothing readable, treat as pure garbage.
          if (!readable || cleaned.length < 4 || wordCount < 3 || dropFiller) {
            setState((st) => ({ ...st, status: 'listening' }));
            return;
          }
          // Suppress a near-identical transcript that double-fires within 5s
          // (same utterance segmented twice).
          const now = performance.now();
          const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
          const last = lastFiredRef.current;
          if (norm(cleaned) === norm(last.text) && now - last.at < 5000) {
            setState((st) => ({ ...st, status: 'listening' }));
            return;
          }
          lastFiredRef.current = { text: cleaned, at: now };

          // LISTEN MODE → append to the live transcript log (real-time follow).
          if (isListen) {
            const id = ++logIdRef.current;
            const time = new Date().toLocaleTimeString();
            setTranscriptLog((prev) => {
              const next = [...prev, { id, time, text: cleaned, translation: '' }];
              return next.length > 500 ? next.slice(next.length - 500) : next;
            });
            setState((st) => ({ ...st, status: 'listening' }));
            // Optional per-line translation (only when enabled and source ≠ PT).
            if (fresh.showTranslation && langRef.current !== 'pt') {
              void window.api.translateLine(cleaned).then((tr) => {
                if (tr)
                  setTranscriptLog((prev) =>
                    prev.map((l) => (l.id === id ? { ...l, translation: tr } : l))
                  );
              });
            }
            return;
          }

          pendingSttRef.current = { durationMs: Math.round(durationMs), sttMs };
          if (triggerRef.current === 'manual') {
            // Capture and display the question, but wait for an explicit trigger.
            setState((st) => ({ ...st, transcript: cleaned, translation: '', suggestedResponse: '', error: undefined, status: 'listening' }));
            setPending(true);
            if (fresh.showTranslation) {
              void window.api.translateLine(cleaned).then((translation) => {
                setState((st) => st.transcript === cleaned && st.status === 'listening' ? { ...st, translation } : st);
              }).catch(() => { /* The answer request can still translate the question. */ });
            }
            return;
          }
          fireAnswer(cleaned);
        } catch (err) {
          console.error('[transcribe] error', err);
          setState((st) => ({ ...st, status: 'error', error: `STT: ${(err as Error).message}` }));
        }
      },
      onError: (err) => {
        console.error('[audio] error', err);
        setState((st) => ({ ...st, status: 'error', error: `Audio: ${err.message}` }));
        setRunning(false);
      },
      onLevel: (rms) => setLevel(rms),
    }, timing);
  }, []);

  const stop = useCallback(() => {
    captureRef.current?.stop();
    captureRef.current = null;
    setRunning(false);
    setLevel(0);
    setState((s) => ({ ...s, status: 'idle' }));
  }, []);

  const needsConfig = useMemo(
    () => !settings?.hasAnthropicKey || !settings?.hasGroqKey || !settings?.resume,
    [settings]
  );

  return (
    <div style={styles.container}>
      <div className="overlay-drag-bar" title="Arraste esta barra para mover a janela">
        <span aria-hidden="true">⠿</span>
        <span>Interview Copilot</span>
        <span className="overlay-drag-hint">Arraste para mover</span>
      </div>
      <div className="workspace-tabs">
        <button aria-pressed={!preparing} onClick={() => setPreparing(false)}>Entrevista ao vivo</button>
        <button aria-pressed={preparing} onClick={() => setPreparing(true)}>Preparação RH / Técnica</button>
        {!settings?.recruiterContext && <button disabled={presetBusy} onClick={async () => {
          setPresetBusy(true);
          try {
            const updated = await window.api.saveSettings(recruiterPreset());
            setSettings(updated);
            setInterviewStyle('hr');
            setInterviewLanguage('en');
            setPreparing(true);
          } catch (err) { setState((st) => ({ ...st, error: (err as Error).message })); }
          finally { setPresetBusy(false); }
        }}>{presetBusy ? 'Preparando…' : 'Preparar entrevista RH'}</button>}
        <span>{interviewStyle === 'hr' ? 'Recrutadora' : 'Técnica'} / {LANGUAGE_LABELS[interviewLanguage]}</span>
      </div>
      <div style={styles.header}>
        <span style={{ ...styles.dot, background: STATUS_COLOR[state.status] }} />
        <span style={styles.headerTitle}>{STATUS_TEXT[state.status]}</span>
        {state.latencyMs > 0 && (
          <span style={styles.latency}>⚡ {(state.latencyMs / 1000).toFixed(1)}s</span>
        )}
        <div style={styles.modeToggle}>
          <button
            style={{
              ...styles.modeBtn,
              ...(mode === 'interview' && interviewStyle === 'technical' ? styles.modeBtnActive : {}),
            }}
            onClick={() => {
              setMode('interview');
              updateInterviewStyle('technical');
            }}
            title="Technical interview — full depth, STAR, technical vocabulary"
          >
            🎙 Tech
          </button>
          <button
            style={{
              ...styles.modeBtn,
              ...(mode === 'interview' && interviewStyle === 'hr' ? styles.modeBtnActive : {}),
            }}
            onClick={() => {
              setMode('interview');
              updateInterviewStyle('hr');
            }}
            title="HR / recruiter screening — short answers, logistics focus, no long paragraphs"
          >
            🤝 HR
          </button>
          <button
            style={{
              ...styles.modeBtn,
              ...(mode === 'listen' ? styles.modeBtnActive : {}),
            }}
            onClick={() => setMode('listen')}
            title="Live transcript — real-time running transcription of a meeting or lecture (optional per-line translation)"
          >
            📝 Transcript
          </button>
        </div>
        <div style={styles.langToggle} title="Answer language — switches live, no restart">
          {LANGS.map((lng) => (
            <button
              key={lng}
              style={{
                ...styles.langBtn,
                ...(interviewLanguage === lng ? styles.langBtnActive : {}),
              }}
              onClick={() => updateInterviewLanguage(lng)}
              title={`${LANGUAGE_LABELS[lng]} — switches live, no restart`}
            >
              {lng.toUpperCase()}
            </button>
          ))}
        </div>
        <button
          style={styles.iconBtn}
          onClick={() => window.api.openCoding()}
          title="Live coding assistant (⌃⇧K)"
        >
          {'</>'}
        </button>
        <button style={styles.iconBtn} onClick={() => window.api.openSettings()} title="Settings">
          ⚙
        </button>
      </div>

      {testContext && (
        <div style={styles.testBadge} title={testContext.slice(0, 400)}>
          <span style={styles.testBadgeLabel}>🧪 Active test context</span>
          <span style={styles.testBadgePreview}>
            {testContext.slice(0, 60).replace(/\s+/g, ' ')}
            {testContext.length > 60 && '…'}
          </span>
          <button style={styles.testBadgeClear} onClick={clearTest} title="Clear active test context">
            ✕
          </button>
        </div>
      )}

      {solution && (
        <div
          style={{
            ...styles.solutionBadge,
            ...(solution.error ? styles.solutionBadgeError : {}),
          }}
          title={
            solution.error
              ? `${solution.error}\n${solution.path}`
              : `${solution.path}\n${solution.fileCount} files, ${(solution.totalChars / 1024).toFixed(0)} KB — answers about this solution are grounded in the real code`
          }
        >
          <span style={styles.testBadgeLabel}>📦 Solution</span>
          <span style={styles.testBadgePreview}>
            {solution.error
              ? solution.fileCount > 0
                ? `${solution.name} · reload failed, previous load active`
                : 'load failed — check Settings'
              : `${solution.name} · ${solution.fileCount} file${solution.fileCount === 1 ? '' : 's'}`}
          </span>
          <button
            style={styles.testBadgeClear}
            onClick={clearSolution}
            title="Clear referenced solution"
          >
            ✕
          </button>
        </div>
      )}

      {needsConfig && (
        <div style={styles.warning}>
          Configure Groq + Anthropic API keys, resume, and JD in Settings before starting.
        </div>
      )}

      <div style={styles.controls}>
        {!running ? (
          <button style={styles.primaryBtn} onClick={() => void start()}>
            ▶ Start session
          </button>
        ) : (
          <button style={styles.dangerBtn} onClick={stop}>
            ■ Stop
          </button>
        )}
        {running && (
          <div style={styles.meterWrap} title={`RMS ${level.toFixed(4)} (threshold 0.012)`}>
            <div
              style={{
                ...styles.meterBar,
                width: `${Math.min(100, level * 1500)}%`,
                background: level > 0.012 ? '#22c55e' : level > 0.003 ? '#f59e0b' : '#3b3b3b',
              }}
            />
            <div style={styles.meterThreshold} />
          </div>
        )}
        {pending && (
          <button style={styles.answerBtn} onClick={() => fireAnswer(state.transcript)}>
            Answer ▶ <kbd style={styles.kbdInline}>⌃⇧R</kbd>
          </button>
        )}
      </div>

      {mode === 'listen' && (
        <div style={styles.transcriptToolbar}>
          <span style={styles.transcriptToolbarTitle}>
            📝 Live transcript · {transcriptLog.length} lines
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            {!autoScroll && (
              <button style={styles.transcriptBtn} onClick={() => setAutoScroll(true)}>
                ↓ Follow
              </button>
            )}
            <button style={styles.transcriptBtn} onClick={copyTranscript}>
              {copied ? '✓' : 'Copy all'}
            </button>
            <button style={styles.transcriptBtn} onClick={clearTranscript}>
              Clear
            </button>
          </div>
        </div>
      )}

      <div
        style={{ ...styles.scrollArea, ...(mode === 'interview' && !preparing ? { display: 'flex', flexDirection: 'column', overflow: 'hidden' } : {}) }}
        ref={mode === 'listen' ? logScrollRef : undefined}
        onScroll={
          mode === 'listen'
            ? (e) => {
                const el = e.currentTarget;
                setAutoScroll(el.scrollTop + el.clientHeight >= el.scrollHeight - 40);
              }
            : undefined
        }
      >
        {preparing && settings ? <HrPreparation settings={settings} onPractice={async (q, style) => {
          try {
            const updated = await window.api.saveSettings({ interviewStyle: style, interviewLanguage: 'en', showTranslation: true, answerLength: 'concise' });
            setSettings(updated);
            setInterviewStyle(style);
            setInterviewLanguage('en');
            setPreparing(false);
            modeRef.current = 'interview';
            setMode('interview');
            fireAnswer(q);
          } catch (err) { setState((st) => ({ ...st, error: (err as Error).message })); }
        }} /> : mode === 'listen' ? (
          transcriptLog.length === 0 ? (
            <div style={styles.emptyState}>
              <div style={styles.emptyIcon}>{running ? '🎧' : '📝'}</div>
              <div style={styles.emptyTitle}>
                {running ? 'Listening — transcript will appear live…' : 'Live transcript mode'}
              </div>
              <div style={styles.emptyHint}>
                {running
                  ? 'Each line is added in real time as people speak.'
                  : 'Start the session to capture a running transcript of a meeting or lecture.'}
              </div>
            </div>
          ) : (
            <div style={styles.transcriptList}>
              {transcriptLog.map((l) => (
                <div key={l.id} style={styles.transcriptLine}>
                  <span style={styles.transcriptTime}>{l.time}</span>
                  <div style={styles.transcriptBody}>
                    <span style={styles.transcriptText}>{l.text}</span>
                    {l.translation && (
                      <span style={styles.transcriptTrans}>↳ {l.translation}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
          <>
        <div className="interview-workspace">
          <div className="question-pair">
            <section className="question-pane" aria-label="Pergunta original">
              <h2>Pergunta original</h2>
              <p>{state.transcript || (running ? 'Ouvindo a recrutadora…' : 'Inicie a sessão ou pratique uma pergunta na preparação RH.')}</p>
            </section>
            <section className="question-pane translation" aria-label="Tradução da pergunta">
              <h2>Tradução em português</h2>
              <p>{state.translation || (!settings?.showTranslation ? 'Ative a tradução em Settings ou em Preparar entrevista RH.' : pending || state.status === 'responding' ? 'Traduzindo a pergunta…' : 'A tradução da pergunta aparecerá aqui.')}</p>
            </section>
          </div>
          <section className="answer-pane" aria-label="Resposta sugerida">
            <div className="answer-toolbar">
              <h2>Sua resposta / {LANGUAGE_LABELS[interviewLanguage]}</h2>
              <button aria-label="Diminuir letra" disabled={fontSize <= 16} onClick={() => setFontSize((n) => Math.max(16, n - 2))}>A−</button>
              <button aria-label="Aumentar letra" disabled={fontSize >= 28} onClick={() => setFontSize((n) => Math.min(28, n + 2))}>A+</button>
              <button disabled={!state.suggestedResponse} onClick={handleCopy}>{copied ? 'Copiado ✓' : 'Copiar'}</button>
              <button disabled={!state.transcript || state.status === 'responding'} onClick={handleRegenerate}>{pending ? 'Gerar resposta' : 'Gerar novamente'}</button>
            </div>
            <div className="answer-scroll">
              {state.suggestedResponse ? (() => {
                const { spoken, probe } = splitSpokenProbe(state.suggestedResponse);
                return <><p className="answer-text" style={{ fontSize }} lang={interviewLanguage}>{spoken}</p>
                  {probe && <details><summary>Se ela pedir mais detalhes</summary>{probe}</details>}</>;
              })() : <p className="prep-hint">{state.status === 'responding' ? 'Preparando uma resposta curta…' : pending ? 'Pergunta capturada. Clique em Gerar resposta ou pressione Ctrl+Shift+R.' : 'Sua resposta aparece aqui, com letra maior e rolagem independente.'}</p>}
            </div>
          </section>
        </div>
          </>
        )}

        {state.error && <div style={styles.error}>⚠ {state.error}</div>}
      </div>

      {timings && (
        <div style={styles.timings}>
          <span title="Audio chunk duration">🎤 {(timings.audioMs / 1000).toFixed(1)}s</span>
          <span title="Whisper STT round-trip">· STT {timings.sttMs}ms</span>
          {timings.llmFirstTokenMs > 0 && (
            <span title="Claude first token latency">· LLM {timings.llmFirstTokenMs}ms→{timings.llmTotalMs}ms</span>
          )}
        </div>
      )}
      <div style={styles.footer}>
        <span>⌃⇧H hide · ⌃⇧R regen · ⌃⇧C copy</span>
      </div>
    </div>
  );
}

// Backchannel / acknowledgment tokens an interviewer says constantly. A transcript
// made up only of these should never trigger (or wipe) an answer.
const FILLER_WORDS: Record<InterviewLanguage, Set<string>> = {
  en: new Set([
    'thank', 'thanks', 'you', 'okay', 'ok', 'i', 'see', 'hmm', 'hm', 'mm', 'mhm', 'uhhuh',
    'great', 'sure', 'right', 'cool', 'yeah', 'yes', 'yep', 'yup', 'alright', 'all', 'so',
    'um', 'uh', 'oh', 'wait', 'got', 'it', 'nice', 'perfect', 'good', 'well', 'and', 'the',
    'a', 'to', 'of', 'minute', 'no', 'gotcha', 'understood', 'exactly', 'totally',
  ]),
  pt: new Set([
    'obrigado', 'obrigada', 'valeu', 'ok', 'tá', 'ta', 'sim', 'não', 'nao', 'certo', 'claro',
    'legal', 'ótimo', 'otimo', 'beleza', 'entendi', 'entendido', 'aham', 'uhum', 'hmm', 'hm',
    'então', 'entao', 'é', 'e', 'o', 'a', 'de', 'pra', 'pro', 'isso', 'aí', 'ai', 'bom',
    'perfeito', 'exato', 'exatamente', 'espera', 'um', 'uh', 'ah', 'oi', 'olá', 'ola',
  ]),
  es: new Set([
    'gracias', 'ok', 'vale', 'sí', 'si', 'no', 'claro', 'bien', 'genial', 'perfecto',
    'entiendo', 'entendido', 'ajá', 'aja', 'mmm', 'hmm', 'eh', 'este', 'pues', 'bueno',
    'y', 'el', 'la', 'de', 'a', 'que', 'eso', 'exacto', 'exactamente', 'espera', 'um',
    'ah', 'oh', 'hola', 'correcto', 'cierto', 'muy',
  ]),
};

// Union of every language's filler set. Detection is language-agnostic because
// the interviewer (or interpreter) may speak a different language than the one
// the candidate answers in — an English "okay, thanks" is still backchannel.
const ALL_FILLER = new Set<string>([
  ...FILLER_WORDS.en,
  ...FILLER_WORDS.pt,
  ...FILLER_WORDS.es,
]);

function isMostlyFiller(text: string): boolean {
  const words = text
    .toLowerCase()
    .replace(/[^a-záàâãéêíóôõúüñç\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return true;
  const meaningful = words.filter((w) => !ALL_FILLER.has(w));
  // If fewer than 3 meaningful (non-filler) words remain, treat as backchannel.
  return meaningful.length < 3;
}

// Common function words per language — used to detect whether a sentence is real
// readable speech vs STT garbage (random tech tokens like ".NET, GCP, S3...").
const LANG_SIGNAL: Record<InterviewLanguage, Set<string>> = {
  en: new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'to', 'of', 'for',
    'and', 'or', 'with', 'you', 'your', 'i', 'how', 'what', 'when', 'where', 'why',
    'who', 'would', 'could', 'should', 'do', 'does', 'did', 'this', 'that', 'these',
    'those', 'on', 'in', 'at', 'by', 'while', 'about', 'can', 'will', 'my', 'me',
    'we', 'they', 'it', 'as', 'but', 'if', 'so', 'into', 'from', 'over', 'between',
    'across', 'their', 'our', 'have', 'has', 'had', 'not', 'than', 'then', 'them',
    'tell', 'describe', 'explain', 'walk', 'give', 'think', 'make', 'design', 'use',
  ]),
  pt: new Set([
    'o', 'a', 'os', 'as', 'um', 'uma', 'de', 'do', 'da', 'dos', 'das', 'em', 'no',
    'na', 'para', 'pra', 'por', 'com', 'que', 'você', 'voce', 'eu', 'como', 'qual',
    'quando', 'onde', 'porque', 'por que', 'quem', 'é', 'são', 'sao', 'foi', 'era',
    'ser', 'estar', 'tem', 'pode', 'poderia', 'fazer', 'fez', 'isso', 'esse', 'essa',
    'este', 'esta', 'sobre', 'mas', 'se', 'então', 'entao', 'me', 'meu', 'minha',
    'nós', 'nos', 'eles', 'seu', 'sua', 'sobre', 'mais', 'também', 'tambem',
    'fale', 'descreva', 'explique', 'conte', 'pense', 'use',
  ]),
  es: new Set([
    'el', 'la', 'los', 'las', 'un', 'una', 'de', 'del', 'en', 'para', 'por', 'con',
    'que', 'tú', 'tu', 'usted', 'yo', 'cómo', 'como', 'cuál', 'cual', 'cuándo',
    'cuando', 'dónde', 'donde', 'por qué', 'porque', 'quién', 'quien', 'es', 'son',
    'fue', 'era', 'ser', 'estar', 'tiene', 'puede', 'podría', 'podria', 'hacer',
    'hizo', 'esto', 'ese', 'esa', 'este', 'esta', 'sobre', 'pero', 'si', 'entonces',
    'me', 'mi', 'nosotros', 'ellos', 'su', 'más', 'mas', 'también', 'tambien',
    'cuéntame', 'cuentame', 'describe', 'explica', 'piensa', 'usa',
  ]),
};

// Union of every language's function words — used for language-agnostic readable-
// speech detection. A real question in ANY supported language qualifies; only
// random tech-token garbage (".NET, GCP, S3...") matches none and is dropped.
const ALL_LANG_SIGNAL = new Set<string>([
  ...LANG_SIGNAL.en,
  ...LANG_SIGNAL.pt,
  ...LANG_SIGNAL.es,
]);

// STT garbage detector: when the audio is noise/echo, Whisper hallucinates the
// vocabulary-hint terms (".NET .NET .NET", "GCP, S3, Azure...") producing long
// runs of comma-separated tech tokens. The REAL question is usually a coherent
// English sentence buried at the end. This extracts the readable speech and
// drops the garbage. Returns '' if nothing readable is found (→ ask to repeat).
// Splits the model output into the SPOKEN answer (read aloud) and the reserve
// PROBE notes (private prep, never spoken). The probe notes begin at the first
// markdown heading or an "If they probe" line. This keeps the spoken surface
// clean so the candidate never accidentally reads "## If they probe" aloud.
function splitSpokenProbe(text: string): { spoken: string; probe: string } {
  const lines = text.split('\n');
  let cut = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*#{1,6}\s/.test(lines[i]) || /^\s*if they probe\b/i.test(lines[i])) {
      cut = i;
      break;
    }
  }
  if (cut === -1) return { spoken: text.trim(), probe: '' };
  return {
    spoken: lines.slice(0, cut).join('\n').trim(),
    probe: lines
      .slice(cut)
      .join('\n')
      .replace(/^\s*#{1,6}\s*/gm, '')
      .replace(/^\s*if they probe\s*:?\s*$/gim, '')
      .trim(),
  };
}

function extractReadableSpeech(raw: string): string {
  let cleaned = raw;
  // Whisper hallucinates closed-caption/credits boilerplate on silent or
  // music-only audio (French TV captioning, "subtitles by", "thanks for
  // watching"...). These are never interviewer speech — strip them anywhere.
  const CAPTION_HALLUCINATIONS = [
    /sous-titrage(?:\s+(?:société|societe))?\s+radio-?canada/gi,
    /sous-titres?\s+(?:réalisés?|realises?)\s+par[^.!?]*/gi,
    /amara\.org/gi,
    /sub(?:title)?s?\s+by[^.!?]*/gi,
    /thanks?\s+for\s+watching[^.!?]*/gi,
    /\bMBC\b\s+\+?/gi,
  ];
  for (const re of CAPTION_HALLUCINATIONS) cleaned = cleaned.replace(re, ' ');
  // Whisper hallucinates junk web domains AND bare "www" tokens on low-energy
  // audio ("www.best.org www.best.org", "www  Are you...", "www.feyyaz.tv").
  cleaned = cleaned.replace(/\b(?:https?:\/\/)?www\.[^\s,]+/gi, ' ');
  cleaned = cleaned.replace(/\b[\w-]+\.(?:com|org|net|tv|io|co|gov|edu|jp|nz|br|de|info)(?:\.[a-z]{2})?\b/gi, ' ');
  // Bare orphan "www" / "http(s)" tokens not followed by a domain.
  cleaned = cleaned.replace(/\b(?:www|https?)\b(?!\S)/gi, ' ');
  // Collapse immediate duplicate words/short phrases ("www www", "the the").
  cleaned = cleaned.replace(/\b(\w{1,20})(\s+\1\b){1,}/gi, '$1');
  // Collapse immediate token repetition (".NET, .NET, .NET" → ".NET").
  const deduped = cleaned.replace(/\b([\w.]+)([,\s]+\1\b){2,}/gi, '$1');

  // Split into sentence-ish segments, keeping it simple.
  const segments = deduped
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const signal = ALL_LANG_SIGNAL;
  const readable = segments.filter((seg) => {
    const tokens = seg
      .toLowerCase()
      .replace(/[^a-záàâãéêíóôõúüñç\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
    if (tokens.length < 3) return false;
    // Count DISTINCT function words so a repeated token from garbage doesn't qualify.
    const distinctSignals = new Set(tokens.filter((t) => signal.has(t)));
    return distinctSignals.size >= 2 && distinctSignals.size / tokens.length >= 0.12;
  });

  return readable.join(' ').trim();
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    fontFamily:
      '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontSize: 14,
    background:
      'linear-gradient(180deg, rgba(15,17,21,0.96) 0%, rgba(20,22,28,0.96) 100%)',
    color: '#e8e8ea',
    borderRadius: 14,
    overflow: 'hidden',
    minWidth: 400,
    boxSizing: 'border-box',
    backdropFilter: 'blur(20px) saturate(180%)',
    WebkitBackdropFilter: 'blur(20px) saturate(180%)',
    border: '0.5px solid rgba(255,255,255,0.08)',
    boxShadow: '0 20px 60px rgba(0,0,0,0.4), 0 0 0 0.5px rgba(255,255,255,0.04) inset',
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    padding: '10px 14px',
    background: 'rgba(255,255,255,0.025)',
    borderBottom: '0.5px solid rgba(255,255,255,0.06)',
    WebkitAppRegion: 'drag',
    flexShrink: 0,
  } as React.CSSProperties,
  dot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    display: 'inline-block',
    boxShadow: '0 0 8px currentColor',
    transition: 'background 200ms',
  },
  headerTitle: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.04em',
    textTransform: 'uppercase' as const,
    opacity: 0.85,
  },
  modeToggle: {
    display: 'flex',
    flex: 1,
    gap: 2,
    background: 'rgba(0,0,0,0.25)',
    borderRadius: 7,
    padding: 3,
    WebkitAppRegion: 'no-drag',
    justifyContent: 'center',
    border: '0.5px solid rgba(255,255,255,0.04)',
  } as React.CSSProperties,
  modeBtn: {
    fontSize: 11,
    padding: '4px 10px',
    border: 'none',
    background: 'transparent',
    color: 'rgba(255,255,255,0.5)',
    cursor: 'pointer',
    borderRadius: 5,
    fontWeight: 500,
    transition: 'all 150ms',
  } as React.CSSProperties,
  modeBtnActive: {
    background: 'rgba(255,255,255,0.08)',
    color: '#fff',
    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
  } as React.CSSProperties,
  latency: {
    fontSize: 10,
    opacity: 0.45,
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 500,
  } as React.CSSProperties,
  langToggle: {
    display: 'flex',
    gap: 2,
    background: 'rgba(0,0,0,0.25)',
    borderRadius: 7,
    padding: 3,
    WebkitAppRegion: 'no-drag',
    border: '0.5px solid rgba(255,255,255,0.04)',
    flexShrink: 0,
  } as React.CSSProperties,
  langBtn: {
    fontSize: 10,
    padding: '4px 7px',
    border: 'none',
    background: 'transparent',
    color: 'rgba(255,255,255,0.5)',
    cursor: 'pointer',
    borderRadius: 5,
    fontWeight: 600,
    letterSpacing: '0.02em',
    transition: 'all 150ms',
  } as React.CSSProperties,
  langBtnActive: {
    background: 'rgba(59,130,246,0.25)',
    color: '#bfdbfe',
    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
  } as React.CSSProperties,
  iconBtn: {
    WebkitAppRegion: 'no-drag',
    background: 'transparent',
    border: 'none',
    color: 'rgba(255,255,255,0.5)',
    cursor: 'pointer',
    fontSize: 16,
    padding: 4,
    borderRadius: 4,
    transition: 'all 150ms',
  } as React.CSSProperties,
  warning: {
    padding: '10px 16px',
    color: '#fbbf24',
    fontSize: 12,
    background: 'linear-gradient(90deg, rgba(251,191,36,0.10), rgba(251,191,36,0.04))',
    borderBottom: '0.5px solid rgba(251,191,36,0.15)',
    flexShrink: 0,
  },
  testBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 12px',
    background: 'linear-gradient(90deg, rgba(167,139,250,0.12), rgba(167,139,250,0.04))',
    borderBottom: '0.5px solid rgba(167,139,250,0.18)',
    fontSize: 11,
    color: '#c4b5fd',
  },
  solutionBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 12px',
    background: 'linear-gradient(90deg, rgba(52,211,153,0.12), rgba(52,211,153,0.04))',
    borderBottom: '0.5px solid rgba(52,211,153,0.18)',
    fontSize: 11,
    color: '#6ee7b7',
  } as React.CSSProperties,
  solutionBadgeError: {
    background: 'linear-gradient(90deg, rgba(251,191,36,0.14), rgba(251,191,36,0.04))',
    borderBottom: '0.5px solid rgba(251,191,36,0.25)',
    color: '#fcd34d',
  } as React.CSSProperties,
  testBadgeLabel: { fontWeight: 600, letterSpacing: '0.02em', flexShrink: 0 },
  testBadgePreview: {
    flex: 1,
    color: 'rgba(196,181,253,0.7)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    fontFamily: 'ui-monospace, monospace',
    fontSize: 10,
  } as React.CSSProperties,
  testBadgeClear: {
    background: 'transparent',
    border: 'none',
    color: '#fca5a5',
    cursor: 'pointer',
    fontSize: 11,
    padding: 2,
    flexShrink: 0,
  } as React.CSSProperties,
  controls: {
    padding: '12px 14px',
    display: 'flex',
    gap: 10,
    alignItems: 'center',
    background: 'rgba(0,0,0,0.15)',
    borderBottom: '0.5px solid rgba(255,255,255,0.04)',
    flexShrink: 0,
  },
  meterWrap: {
    position: 'relative',
    flex: 1,
    height: 6,
    background: 'rgba(255,255,255,0.04)',
    borderRadius: 3,
    overflow: 'hidden',
  },
  meterBar: {
    height: '100%',
    transition: 'width 60ms linear, background 200ms',
    borderRadius: 3,
  },
  meterThreshold: {
    position: 'absolute',
    top: -2,
    bottom: -2,
    left: '18%',
    width: 1,
    background: 'rgba(255,255,255,0.35)',
  },
  primaryBtn: {
    padding: '7px 16px',
    borderRadius: 7,
    border: '0.5px solid rgba(34,197,94,0.35)',
    background:
      'linear-gradient(180deg, rgba(34,197,94,0.22), rgba(34,197,94,0.12))',
    color: '#86efac',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: '0.02em',
    boxShadow: '0 1px 2px rgba(0,0,0,0.2), 0 0 12px rgba(34,197,94,0.1)',
  },
  dangerBtn: {
    padding: '7px 16px',
    borderRadius: 7,
    border: '0.5px solid rgba(239,68,68,0.35)',
    background:
      'linear-gradient(180deg, rgba(239,68,68,0.22), rgba(239,68,68,0.12))',
    color: '#fca5a5',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: '0.02em',
  },
  answerBtn: {
    padding: '7px 14px',
    borderRadius: 7,
    border: '0.5px solid rgba(59,130,246,0.45)',
    background: 'linear-gradient(180deg, rgba(59,130,246,0.28), rgba(59,130,246,0.16))',
    color: '#bfdbfe',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    animation: 'pulse 1.5s infinite',
  } as React.CSSProperties,
  kbdInline: {
    fontSize: 9,
    padding: '1px 4px',
    borderRadius: 3,
    background: 'rgba(0,0,0,0.3)',
    border: '0.5px solid rgba(255,255,255,0.12)',
    fontFamily: 'ui-monospace, monospace',
  } as React.CSSProperties,
  scrollArea: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    overflowX: 'hidden',
    scrollbarWidth: 'thin',
  } as React.CSSProperties,
  transcriptToolbar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '6px 14px',
    background: 'rgba(0,0,0,0.2)',
    borderBottom: '0.5px solid rgba(255,255,255,0.05)',
    fontSize: 11,
    flexShrink: 0,
  },
  transcriptToolbarTitle: { color: 'rgba(255,255,255,0.55)', fontWeight: 600 },
  transcriptBtn: {
    fontSize: 10,
    padding: '3px 8px',
    borderRadius: 5,
    border: '0.5px solid rgba(255,255,255,0.12)',
    background: 'rgba(255,255,255,0.05)',
    color: '#d4d4d8',
    cursor: 'pointer',
  } as React.CSSProperties,
  transcriptList: { padding: '8px 0' },
  transcriptLine: {
    display: 'flex',
    gap: 8,
    padding: '5px 14px',
    borderBottom: '0.5px solid rgba(255,255,255,0.03)',
  },
  transcriptTime: {
    fontSize: 9,
    color: 'rgba(255,255,255,0.3)',
    fontVariantNumeric: 'tabular-nums' as const,
    flexShrink: 0,
    marginTop: 2,
    fontFamily: 'ui-monospace, monospace',
  } as React.CSSProperties,
  transcriptBody: { display: 'flex', flexDirection: 'column' as const, gap: 2, flex: 1 },
  transcriptText: { fontSize: 13.5, lineHeight: 1.5, color: '#e8e8ea' },
  transcriptTrans: { fontSize: 12, lineHeight: 1.45, color: '#93c5fd', opacity: 0.85 },
  section: {
    padding: '14px 18px',
    borderBottom: '0.5px solid rgba(255,255,255,0.04)',
  },
  sectionLow: {
    background: 'rgba(255,255,255,0.015)',
  },
  sectionMedium: {
    background:
      'linear-gradient(90deg, rgba(59,130,246,0.10), rgba(59,130,246,0.04))',
    borderLeft: '2px solid rgba(59,130,246,0.5)',
  },
  sectionHigh: {
    background:
      'linear-gradient(180deg, rgba(34,197,94,0.06), rgba(34,197,94,0.02))',
    borderLeft: '2px solid rgba(34,197,94,0.6)',
  },
  sectionLabel: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.10em',
    textTransform: 'uppercase' as const,
    opacity: 0.55,
    marginBottom: 8,
    userSelect: 'none' as const,
  },
  sectionLabelText: {},
  sectionToggle: {
    fontSize: 9,
    opacity: 0.6,
    fontWeight: 500,
  },
  contentLow: {
    fontSize: 12,
    lineHeight: 1.55,
    color: 'rgba(232,232,234,0.65)',
    fontStyle: 'italic' as const,
  },
  contentMedium: {
    fontSize: 14,
    lineHeight: 1.6,
    color: '#bfdbfe',
    fontWeight: 500,
  },
  contentHigh: {
    fontSize: 15.5,
    lineHeight: 1.7,
    color: '#f4f4f5',
    fontWeight: 400,
    letterSpacing: '0.005em',
  },
  paragraph: {
    margin: '0 0 10px',
    whiteSpace: 'pre-wrap' as const,
  } as React.CSSProperties,
  probeBox: {
    marginTop: 12,
    padding: '8px 10px',
    borderRadius: 8,
    background: 'rgba(255,255,255,0.03)',
    border: '0.5px dashed rgba(255,255,255,0.12)',
    opacity: 0.6,
  },
  probeLabel: {
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: '0.08em',
    color: '#fbbf24',
    marginBottom: 5,
  },
  probeText: {
    fontSize: 12,
    lineHeight: 1.5,
    color: 'rgba(232,232,234,0.7)',
    whiteSpace: 'pre-wrap' as const,
  } as React.CSSProperties,
  actions: { display: 'flex', gap: 8, marginTop: 14 },
  actionBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 12,
    fontWeight: 500,
    padding: '6px 12px',
    borderRadius: 6,
    border: '0.5px solid rgba(255,255,255,0.10)',
    background: 'rgba(255,255,255,0.04)',
    color: '#d4d4d8',
    cursor: 'pointer',
    transition: 'all 150ms',
  } as React.CSSProperties,
  actionBtnPrimary: {
    background: 'rgba(34,197,94,0.15)',
    border: '0.5px solid rgba(34,197,94,0.3)',
    color: '#86efac',
  } as React.CSSProperties,
  kbd: {
    fontSize: 9,
    padding: '1px 5px',
    borderRadius: 3,
    background: 'rgba(0,0,0,0.3)',
    border: '0.5px solid rgba(255,255,255,0.08)',
    fontFamily: 'ui-monospace, monospace',
    opacity: 0.7,
  } as React.CSSProperties,
  emptyState: {
    padding: '40px 24px',
    textAlign: 'center' as const,
    color: 'rgba(255,255,255,0.4)',
  },
  emptyIcon: { fontSize: 32, marginBottom: 12 },
  emptyTitle: { fontSize: 14, fontWeight: 500, marginBottom: 4, color: 'rgba(255,255,255,0.7)' },
  emptyHint: { fontSize: 11, opacity: 0.6 },
  error: {
    margin: '10px 14px',
    padding: '10px 14px',
    color: '#fca5a5',
    fontSize: 12,
    background: 'rgba(239,68,68,0.08)',
    border: '0.5px solid rgba(239,68,68,0.2)',
    borderRadius: 6,
  },
  timings: {
    display: 'flex',
    gap: 8,
    padding: '6px 14px',
    fontSize: 10,
    color: 'rgba(255,255,255,0.4)',
    background: 'rgba(0,0,0,0.25)',
    borderTop: '0.5px solid rgba(255,255,255,0.04)',
    fontVariantNumeric: 'tabular-nums' as const,
    flexShrink: 0,
  } as React.CSSProperties,
  footer: {
    padding: '7px 14px',
    fontSize: 10,
    opacity: 0.35,
    background: 'rgba(0,0,0,0.2)',
    flexShrink: 0,
    textAlign: 'center' as const,
    letterSpacing: '0.03em',
  } as React.CSSProperties,
};
