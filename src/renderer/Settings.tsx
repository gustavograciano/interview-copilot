import React, { useEffect, useState } from 'react';
import type { AppSettings, ModelOption, SolutionInfo, ToneOption } from '../shared/types';
import { listAudioInputDevices } from './audio';

const MODELS: { value: ModelOption; label: string }[] = [
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 — fastest, recommended' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 — balanced' },
  { value: 'claude-opus-4-7', label: 'Claude Opus 4.7 — slowest, most capable' },
];

export function Settings() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [groqKey, setGroqKey] = useState('');
  const [anthropicKey, setAnthropicKey] = useState('');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    groq: boolean;
    anthropic: boolean;
    groqError?: string;
    anthropicError?: string;
  } | null>(null);
  const [saved, setSaved] = useState(false);
  // Save must only write the fields the user actually edited HERE. Other
  // windows mutate settings live (Overlay toggles language/style, Coding pins
  // the test context); sending this window's mount-time snapshot on Save would
  // silently revert those changes.
  const [dirty, setDirty] = useState<Set<keyof AppSettings>>(new Set());
  // Referenced solution — managed via its own IPC (loads immediately, not on Save).
  const [solPath, setSolPath] = useState('');
  const [solInfo, setSolInfo] = useState<SolutionInfo | null>(null);
  const [solBusy, setSolBusy] = useState(false);

  useEffect(() => {
    void window.api.getSettings().then((s) => {
      setSettings(s);
      setSolPath(s.solutionPath);
    });
    void window.api.getSolutionInfo().then(setSolInfo);
    // Probe permission so device labels are populated
    void navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((s) => s.getTracks().forEach((t) => t.stop()))
      .catch(() => {
        /* user can grant later */
      })
      .finally(async () => {
        setDevices(await listAudioInputDevices());
      });
  }, []);

  // Keep the referenced-solution section in sync when it changes from another
  // window (e.g. cleared via the Overlay badge's ✕).
  useEffect(() => {
    const off = window.api.onSolutionChanged((sol) => {
      setSolInfo(sol);
      if (!sol) setSolPath('');
      else if (!sol.error) setSolPath(sol.path);
    });
    return off;
  }, []);

  if (!settings) return <div style={{ padding: 20 }}>Loading…</div>;

  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings({ ...settings, [key]: value });
    setDirty((d) => new Set(d).add(key));
  };

  const save = async () => {
    setSaved(false);
    if (groqKey || anthropicKey) {
      await window.api.saveAPIKeys({
        groq: groqKey || undefined,
        anthropic: anthropicKey || undefined,
      });
      setGroqKey('');
      setAnthropicKey('');
    }
    // Only the fields edited in this window — never the full snapshot, which
    // would revert live changes made from the Overlay/Coding windows.
    const patch: Partial<AppSettings> = {};
    for (const key of dirty) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (patch as any)[key] = settings[key];
    }
    const updated = await window.api.saveSettings(patch);
    setSettings(updated);
    setDirty(new Set());
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const testKeys = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      // Save keys first if just typed
      if (groqKey || anthropicKey) {
        await window.api.saveAPIKeys({
          groq: groqKey || undefined,
          anthropic: anthropicKey || undefined,
        });
        setGroqKey('');
        setAnthropicKey('');
        setSettings(await window.api.getSettings());
      }
      const r = await window.api.testKeys();
      setTestResult(r);
    } finally {
      setTesting(false);
    }
  };

  const loadSolutionAt = async (p: string) => {
    if (!p.trim()) return;
    setSolBusy(true);
    try {
      const info = await window.api.setSolutionPath(p.trim());
      setSolInfo(info);
      if (!info.error) setSolPath(info.path);
    } finally {
      setSolBusy(false);
    }
  };

  const browseSolution = async (kind: 'file' | 'folder') => {
    const p = await window.api.browseSolution(kind);
    if (p) {
      setSolPath(p);
      await loadSolutionAt(p);
    }
  };

  const clearSolution = async () => {
    await window.api.clearSolution();
    setSolInfo(null);
    setSolPath('');
  };

  return (
    <div style={s.container}>
      <h2 style={s.h2}>Interview Copilot — Settings</h2>

      <Section title="API Keys">
        <p style={s.help}>
          Stored encrypted via OS keychain. Configured: Groq:{' '}
          <strong>{settings.hasGroqKey ? '✓' : '—'}</strong>, Anthropic:{' '}
          <strong>{settings.hasAnthropicKey ? '✓' : '—'}</strong>
        </p>
        <Field label="Groq API Key (speech-to-text — free at console.groq.com)">
          <input
            type="password"
            value={groqKey}
            onChange={(e) => setGroqKey(e.target.value)}
            placeholder={
              settings.hasGroqKey ? '•••• (configured — leave blank to keep)' : 'gsk_…'
            }
            style={s.input}
          />
        </Field>
        <Field label="Anthropic API Key">
          <input
            type="password"
            value={anthropicKey}
            onChange={(e) => setAnthropicKey(e.target.value)}
            placeholder={
              settings.hasAnthropicKey ? '•••• (configured — leave blank to keep)' : 'sk-ant-…'
            }
            style={s.input}
          />
        </Field>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
          <button style={s.btn} onClick={() => void testKeys()} disabled={testing}>
            {testing ? 'Testing…' : 'Test keys'}
          </button>
          {testResult && (
            <div style={{ ...s.help, flex: 1 }}>
              <div>
                Groq:{' '}
                <strong style={{ color: testResult.groq ? '#16a34a' : '#dc2626' }}>
                  {testResult.groq ? 'OK' : 'FAIL'}
                </strong>{' '}
                · Anthropic:{' '}
                <strong style={{ color: testResult.anthropic ? '#16a34a' : '#dc2626' }}>
                  {testResult.anthropic ? 'OK' : 'FAIL'}
                </strong>
              </div>
              {testResult.groqError && (
                <div style={{ color: '#dc2626', marginTop: 4, wordBreak: 'break-all' }}>
                  Groq: {testResult.groqError}
                </div>
              )}
              {testResult.anthropicError && (
                <div style={{ color: '#dc2626', marginTop: 4, wordBreak: 'break-all' }}>
                  Anthropic: {testResult.anthropicError}
                </div>
              )}
            </div>
          )}
        </div>
      </Section>

      <Section title="Candidate profile (CV)">
        <textarea
          value={settings.resume}
          onChange={(e) => update('resume', e.target.value)}
          rows={10}
          placeholder="Paste your résumé summary here (technologies, projects, outcomes)…"
          style={s.textarea}
        />
      </Section>

      <Section title="Vocabulary hints (proper nouns / technical terms)">
        <textarea
          value={settings.vocabularyHints}
          onChange={(e) => update('vocabularyHints', e.target.value)}
          rows={2}
          placeholder="NepeCorp, Comunikime, PGR, NR-28, BestOffer, Pirelli, Bayer, .NET, PostgreSQL"
          style={s.textarea}
        />
        <p style={s.help}>
          Comma-separated list. Helps Whisper spell brand names and acronyms correctly.
        </p>
      </Section>

      <Section title="Example Q&A (few-shot — strongly improves output style)">
        <textarea
          value={settings.examples}
          onChange={(e) => update('examples', e.target.value)}
          rows={14}
          placeholder={`Format: alternating "Q:" and "A:" blocks. 3-5 examples is the sweet spot. Be specific — mention real projects, metrics, and trade-offs.

Q: Tell me about a time you had to deliver under a tight deadline.
A: At NepeCorp, I had a 120-day contract worth R$40K to deliver a regulatory compliance platform (PGR) with strict deadline tied to a fiscal incentive law. Situation: scope included multi-tenant architecture, AI-powered safety risk assessment, and CIPA module — too much for the timeline with a 2-person team. Task: prioritize what would unblock the customer's audit while deferring nice-to-haves. Action: I scoped the MVP to NR-28 compliance core, used .NET 8 + EF Core scaffolding heavily, and wrote 1000+ tests in parallel to avoid regressions. Result: shipped on day 118, customer passed the audit, and we got a 6-month maintenance contract on top.

Q: How do you approach a complex integration?
A: At BRBMX (Bayer Mexico loyalty platform), I had to integrate SQL Server and PostgreSQL across two legal entities with linked-server queries that enforced 20-80 proportional payment splits and Brazilian fiscal compliance (NF-e, CFOP, NCM). My approach: 1) Map domain rules first on paper — fiscal regulations don't bend, so I codified them as a rule engine before writing SQL. 2) Use linked servers only for read joins; writes go through dedicated services with idempotency keys. 3) Add an integration test suite that replays real fiscal scenarios. Trade-off considered: I chose linked servers over Kafka here because the latency wasn't critical and ops simplicity mattered for a 5-dev team. Result: zero fiscal exceptions in 18 months of production.

Q: Describe a technical decision you regret.
A: ...`}
          style={s.textarea}
        />
        <p style={s.help}>
          These examples are cached via prompt caching — they add zero latency after the first
          request. Best results come from 3-5 high-quality answers with specific names, numbers,
          and trade-offs from your actual experience.
        </p>
      </Section>

      <Section title="Target job description (JD)">
        <textarea
          value={settings.jobDescription}
          onChange={(e) => update('jobDescription', e.target.value)}
          rows={6}
          placeholder="Paste the job description for THIS interview…"
          style={s.textarea}
        />
      </Section>

      <Section title="Behavior">
        <Field label="Interview language">
          <select
            value={settings.interviewLanguage}
            onChange={(e) =>
              update('interviewLanguage', e.target.value as import('../shared/types').InterviewLanguage)
            }
            style={s.input}
          >
            <option value="en">English — interviewer speaks English, answers in English</option>
            <option value="pt">Português — entrevista em português, respostas em português</option>
            <option value="es">Español — entrevista en español, respuestas en español</option>
          </select>
          <p style={s.help}>
            Sets the speech-to-text language, the language of the suggested answers, and the
            backchannel/garbage filters. When set to Português, the translation panel is hidden
            (no point translating Portuguese to Portuguese).
          </p>
        </Field>
        <Field label="Show Portuguese translation">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={settings.showTranslation}
              onChange={(e) => update('showTranslation', e.target.checked)}
            />
            <span>Generate a Portuguese translation alongside the English answer</span>
          </label>
          <p style={s.help}>
            Disable for faster, more focused output (recommended if you understand English well).
            The English answer arrives ~30% sooner without the translation step.
          </p>
        </Field>
        <Field label="When to generate the answer">
          <select
            value={settings.triggerMode}
            onChange={(e) => update('triggerMode', e.target.value as import('../shared/types').TriggerMode)}
            style={s.input}
          >
            <option value="auto">Auto — answer as soon as the speaker pauses</option>
            <option value="manual">Manual — capture the question, generate only when I press ⌃⇧R</option>
          </select>
          <p style={s.help}>
            Manual mode prevents the interviewer's "okay / thank you / I see" from triggering or
            wiping your answer — you decide exactly when to generate. Auto mode also now ignores
            filler/backchannel automatically, but Manual gives full control for live calls.
          </p>
        </Field>
        <Field label="Answer length">
          <select
            value={settings.answerLength}
            onChange={(e) => update('answerLength', e.target.value as import('../shared/types').AnswerLength)}
            style={s.input}
          >
            <option value="cues">Cues — keyword prompts only, you speak from memory (best for not getting caught reading)</option>
            <option value="concise">Concise — short spoken answer (≤60-90 words) + reserve points</option>
            <option value="balanced">Balanced — 1-2 paragraphs + reserve points</option>
            <option value="detailed">Detailed — full thorough answers</option>
          </select>
          <p style={s.help}>
            <strong>Cues</strong> shows 3-5 short keyword prompts instead of sentences, so you talk
            in your own words while glancing — the most natural on camera and the hardest to detect.
            <strong> Concise</strong> gives short speakable sentences. Avoid Balanced/Detailed on a
            live video call: long on-screen prose forces visible reading.
          </p>
        </Field>
        <Field label="Response tone">
          <select
            value={settings.tone}
            onChange={(e) => update('tone', e.target.value as ToneOption)}
            style={s.input}
          >
            <option value="conversational">Conversational</option>
            <option value="formal">Formal</option>
          </select>
        </Field>
        <Field label="Model">
          <select
            value={settings.model}
            onChange={(e) => update('model', e.target.value as ModelOption)}
            style={s.input}
          >
            {MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Audio input device">
          <select
            value={settings.audioDeviceId}
            onChange={(e) => update('audioDeviceId', e.target.value)}
            style={s.input}
          >
            <option value="">Default (system mic)</option>
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `(unnamed ${d.deviceId.slice(0, 6)}…)`}
              </option>
            ))}
          </select>
          <p style={s.help}>
            Pick the virtual loopback device (VB-Cable / BlackHole / Stereo Mix) to capture
            interviewer audio. For YouTube testing, set CABLE Output as the OS default mic.
          </p>
        </Field>
      </Section>

      <Section title="Auto-typer (Live Coding)">
        <Field label="Typing speed">
          <select
            value={settings.typingSpeed}
            onChange={(e) =>
              update('typingSpeed', e.target.value as import('../shared/types').TypingSpeed)
            }
            style={s.input}
          >
            <option value="slow">Slow — most human (≈120ms/char + long pauses)</option>
            <option value="medium">Medium — balanced (≈70ms/char)</option>
            <option value="fast">Fast — quick but more uniform (≈35ms/char)</option>
          </select>
          <p style={s.help}>
            Controls how fast the auto-typer writes into the focused window. Slower looks more
            human but takes longer for big answers. Medium is the recommended default.
          </p>
        </Field>
        <Field label="Countdown before typing starts (seconds)">
          <input
            type="number"
            min={1}
            max={10}
            value={settings.typingStartDelaySec}
            onChange={(e) => update('typingStartDelaySec', Math.max(1, Math.min(10, +e.target.value || 3)))}
            style={s.input}
          />
          <p style={s.help}>
            After you press the Type button (or ⌃⇧T), you get this many seconds to click into the
            target field. 3s is usually enough.
          </p>
        </Field>
        <Field label="Lock typing to the focused window">
          <select
            value={settings.typingLockToWindow ? 'on' : 'off'}
            onChange={(e) => update('typingLockToWindow', e.target.value === 'on')}
            style={s.input}
          >
            <option value="on">On — stop typing if I click another window (recommended)</option>
            <option value="off">Off — keep typing regardless of focus</option>
          </select>
          <p style={s.help}>
            When ON, the auto-typer locks to whichever window is focused at the end of the
            countdown. If you click anywhere else during typing, it stops immediately so it can't
            accidentally type into another app.
          </p>
        </Field>
      </Section>

      <Section title="HR / screening Q&A (used when overlay mode = 🤝 HR)">
        <textarea
          value={settings.hrExamples}
          onChange={(e) => update('hrExamples', e.target.value)}
          rows={10}
          placeholder={`Short Q:/A: pairs for recruiter screening calls — logistics, salary, notice period, contract type, English level, etc. Used ONLY when the overlay is in HR mode. If left blank, the technical examples are used as fallback.\n\nQ: What are your salary expectations?\nA: I'm looking for around USD 4,000 per month for a senior remote role. Flexible depending on the overall package.\n\nQ: What's your notice period?\nA: Standard 30-day notice in Brazil. I can transition within 30 days of signing.`}
          style={s.textarea}
        />
        <p style={s.help}>
          Shorter, more direct examples. No STAR stories, no production-vocabulary depth — just
          how a candidate naturally answers a recruiter on logistics, motivation, and high-level
          background. Active only when the overlay is in 🤝 HR mode.
        </p>
      </Section>

      <Section title="Active test context (advanced)">
        <p style={s.help}>
          When set, the interview overlay uses this context to answer questions like
          "why did you make decision X" about a recent coding test. Auto-populated by the
          📌 button in the Live Coding window, or paste manually below (paste the problem
          statement and your solution / approach).
        </p>
        <textarea
          value={settings.activeTestContext}
          onChange={(e) => update('activeTestContext', e.target.value)}
          rows={6}
          placeholder={'Problem:\n[paste problem here]\n\nMy solution / approach:\n[paste solution and key decisions]'}
          style={s.textarea}
        />
        {settings.activeTestContext && (
          <button
            style={{ ...s.btn, marginTop: 8 }}
            onClick={() => update('activeTestContext', '')}
          >
            Clear test context
          </button>
        )}
      </Section>

      <Section title="Referenced solution (challenge you already submitted)">
        <p style={s.help}>
          Point to the solution you sent the company — a single file or the project folder. The
          files are read from disk and injected into the prompts (cached, zero latency after the
          first answer). The interview overlay then answers "how does it work / why did you do X"
          from the REAL code, and the Live Coding window proposes changes against the real files
          when the interviewer asks to modify something.
        </p>
        <Field label="Path to file or folder">
          <input
            value={solPath}
            onChange={(e) => setSolPath(e.target.value)}
            placeholder={'C:\\Users\\you\\Downloads\\my-challenge  (or ...\\index.html)'}
            style={s.input}
          />
        </Field>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button style={s.btn} onClick={() => void browseSolution('folder')} disabled={solBusy}>
            Browse folder…
          </button>
          <button style={s.btn} onClick={() => void browseSolution('file')} disabled={solBusy}>
            Browse file…
          </button>
          <button
            style={{ ...s.btn, ...s.btnPrimary }}
            onClick={() => void loadSolutionAt(solPath)}
            disabled={solBusy || !solPath.trim()}
          >
            {solBusy ? 'Loading…' : solInfo && solInfo.fileCount > 0 ? 'Reload from disk' : 'Load'}
          </button>
          {solInfo && (
            <button style={s.btn} onClick={() => void clearSolution()} disabled={solBusy}>
              Clear
            </button>
          )}
        </div>
        {solInfo && solInfo.error && (
          <p style={{ ...s.help, color: '#dc2626', marginTop: 8 }}>
            ✗ {solInfo.error}
            {solInfo.fileCount > 0 &&
              ` — the previously loaded files (${solInfo.name}, ${solInfo.fileCount} file${solInfo.fileCount === 1 ? '' : 's'}) are STILL active in the prompts. Fix the path and reload, or Clear.`}
          </p>
        )}
        {solInfo && !solInfo.error && (
          <p style={{ ...s.help, color: '#16a34a', marginTop: 8 }}>
            {`✓ ${solInfo.name} — ${solInfo.fileCount} file${solInfo.fileCount === 1 ? '' : 's'}, ${(solInfo.totalChars / 1024).toFixed(0)} KB loaded` +
              (solInfo.truncated
                ? ` (truncated${solInfo.omittedFiles ? `, ${solInfo.omittedFiles} files omitted` : ''} — keep the folder lean)`
                : '')}
          </p>
        )}
        <p style={s.help}>
          Reload after editing the files on disk. The path is remembered and re-read on every app
          launch. node_modules, build output, lock files, and minified assets are skipped
          automatically.
        </p>
      </Section>

      <Section title="Session logs">
        <p style={s.help}>
          Every generated question, translation, and answer is logged to a daily JSONL file.
          Review them afterward to refine your examples and prompt.
        </p>
        <button style={s.btn} onClick={() => void window.api.openLogs()}>
          Open logs folder
        </button>
      </Section>

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button style={{ ...s.btn, ...s.btnPrimary }} onClick={() => void save()}>
          Save
        </button>
        {saved && <span style={{ ...s.help, color: '#16a34a' }}>Saved ✓</span>}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={s.section}>
      <h3 style={s.h3}>{title}</h3>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={s.field}>
      <span style={s.label}>{label}</span>
      {children}
    </label>
  );
}

const s: Record<string, React.CSSProperties> = {
  container: {
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: 14,
    color: '#1f2937',
    background: '#fff',
    padding: 24,
    maxWidth: 720,
    margin: '0 auto',
  },
  h2: { margin: '0 0 16px', fontSize: 20 },
  h3: { margin: '0 0 8px', fontSize: 14, fontWeight: 600, color: '#374151' },
  section: { marginBottom: 20, padding: 16, border: '1px solid #e5e7eb', borderRadius: 8 },
  field: { display: 'flex', flexDirection: 'column' as const, marginBottom: 10, gap: 4 },
  label: { fontSize: 12, fontWeight: 500, color: '#4b5563' },
  input: {
    padding: '6px 10px',
    fontSize: 13,
    border: '1px solid #d1d5db',
    borderRadius: 4,
    fontFamily: 'inherit',
  },
  textarea: {
    width: '100%',
    padding: '8px 10px',
    fontSize: 13,
    border: '1px solid #d1d5db',
    borderRadius: 4,
    fontFamily: 'monospace',
    resize: 'vertical' as const,
    boxSizing: 'border-box' as const,
  },
  btn: {
    padding: '6px 14px',
    fontSize: 13,
    border: '1px solid #d1d5db',
    borderRadius: 4,
    background: '#fff',
    cursor: 'pointer',
  },
  btnPrimary: { background: '#2563eb', color: '#fff', borderColor: '#2563eb' },
  help: { fontSize: 12, color: '#6b7280', margin: '4px 0' },
};
