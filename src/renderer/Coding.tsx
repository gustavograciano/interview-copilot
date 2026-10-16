import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  LANGUAGE_LABELS,
  type CodingMessage,
  type InterviewLanguage,
  type SolutionInfo,
} from '../shared/types';

const LANGS: InterviewLanguage[] = ['en', 'pt', 'es'];

interface StagedImage {
  data: string; // base64
  mediaType: string;
}

export function Coding() {
  const [history, setHistory] = useState<CodingMessage[]>([]);
  const [input, setInput] = useState('');
  const [stagedImages, setStagedImages] = useState<StagedImage[]>([]);
  const [streaming, setStreaming] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [typing, setTyping] = useState(false);
  const [typeCountdown, setTypeCountdown] = useState<number | null>(null);
  const [typeProgress, setTypeProgress] = useState<{ typed: number; total: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Explanation language for generated solutions (Approach / Sanity / How to
  // explain). Shares the interviewLanguage setting; switches live, no restart —
  // main reads getSettings() per request, so the next solution uses the new one.
  const [language, setLanguage] = useState<InterviewLanguage>('en');
  useEffect(() => {
    void window.api.getSettings().then((st) => setLanguage(st.interviewLanguage));
  }, []);

  // Referenced-solution indicator — shows that change requests will be proposed
  // against the real files of the submitted solution.
  const [solution, setSolution] = useState<SolutionInfo | null>(null);
  useEffect(() => {
    void window.api.getSolutionInfo().then(setSolution);
    const off = window.api.onSolutionChanged(setSolution);
    return off;
  }, []);
  const updateLanguage = useCallback((next: InterviewLanguage) => {
    setLanguage(next);
    void window.api.saveSettings({ interviewLanguage: next });
  }, []);

  // Extract the plain code/text from the last assistant response. For coding
  // problems we send the WHOLE response to the typer; the user can clean it up.
  // But often the user only wants the code block. For simplicity we send the
  // full assistant text — the user can pre-strip via a textarea before typing
  // in a future iteration.
  const lastAssistantText = (() => {
    for (let i = history.length - 1; i >= 0; i--) {
      const m = history[i];
      if (m.role === 'assistant' && typeof m.content === 'string') return m.content;
    }
    return '';
  })();

  // Extract just code-fenced block(s) from the last response — most assessments
  // want just the code, not the Approach/Sanity-check sections.
  const extractCode = (text: string): string => {
    const blocks: string[] = [];
    const re = /```[\w]*\r?\n([\s\S]*?)```/g;
    let m;
    while ((m = re.exec(text)) !== null) blocks.push(m[1].trimEnd());
    if (blocks.length > 0) return blocks.join('\n\n');
    // No fenced code block — DON'T dump the markdown scaffold (## Approach,
    // ## How to explain it out loud, etc.) into the editor. Strip heading lines
    // and any "How to explain / Sanity check / Approach" prose sections, and
    // drop emoji, so the auto-typer never types tells.
    return text
      .replace(/^\s*#{1,6}\s.*$/gm, '') // markdown headings
      .replace(/^\s*\*\*.*\*\*\s*$/gm, '') // bold-only lines
      .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}✅❌]/gu, '') // emoji/symbols
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  };

  // Subscribe to streaming events
  useEffect(() => {
    const offTok = window.api.onCodingToken((chunk) => setStreaming(chunk));
    const offDone = window.api.onCodingDone((full) => {
      setHistory((h) => [...h, { role: 'assistant', content: full }]);
      setStreaming('');
      setBusy(false);
    });
    const offErr = window.api.onCodingError((msg) => {
      setError(msg);
      setStreaming('');
      setBusy(false);
    });
    const offCap = window.api.onScreenCaptured((p) => {
      setStagedImages((prev) => [...prev, p]);
      setError(null);
    });
    const offCD = window.api.onTypeCountdown((sec) => {
      setTypeCountdown(sec > 0 ? sec : null);
    });
    const offProg = window.api.onTypeProgress((p) => setTypeProgress(p));
    const offTypeDone = window.api.onTypeDone(({ reason }) => {
      setTyping(false);
      setTypeCountdown(null);
      setTypeProgress(null);
      if (reason === 'focus-lost') {
        setError(
          '⌨️ Typing stopped because the focused window changed. Click back into the target field and press ⌃⇧T to resume from the start.'
        );
      }
    });
    return () => {
      offTok();
      offDone();
      offErr();
      offCap();
      offCD();
      offProg();
      offTypeDone();
    };
  }, []);

  // Auto-scroll to bottom as content streams
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [history, streaming]);

  const captureNow = useCallback(async () => {
    if (capturing) return;
    setCapturing(true);
    setError(null);
    try {
      const cap = await window.api.captureScreen();
      setStagedImages((prev) => [...prev, cap]);
    } catch (err) {
      setError(`Screen capture failed: ${(err as Error).message}`);
    } finally {
      setCapturing(false);
    }
  }, [capturing]);

  const send = useCallback(() => {
    if ((!input.trim() && stagedImages.length === 0) || busy) return;
    setError(null);

    let userMessage: CodingMessage;
    if (stagedImages.length > 0) {
      const textPart = input.trim()
        ? input.trim()
        : stagedImages.length === 1
          ? 'Solve the coding problem shown in this screenshot. Default to C# / .NET unless the language is explicitly specified in the problem.'
          : `Solve the coding problem shown across these ${stagedImages.length} screenshots (read them in order — they are sequential parts of the same problem). Default to C# / .NET unless the language is explicitly specified.`;
      userMessage = {
        role: 'user',
        content: [
          ...stagedImages.map((img) => ({
            type: 'image' as const,
            mediaType: img.mediaType,
            data: img.data,
          })),
          { type: 'text' as const, text: textPart },
        ],
      };
    } else {
      userMessage = { role: 'user', content: input.trim() };
    }

    const next = [...history, userMessage];
    setHistory(next);
    setInput('');
    setStagedImages([]);
    setStreaming('');
    setBusy(true);
    void window.api.startCoding(next);
  }, [input, stagedImages, history, busy]);

  const removeStaged = (idx: number) => {
    setStagedImages((prev) => prev.filter((_, i) => i !== idx));
  };
  const clearStaged = () => setStagedImages([]);

  // Start auto-typing the last assistant response (code-only by default).
  const startTyping = useCallback(
    (mode: 'code' | 'full') => {
      if (typing || !lastAssistantText) return;
      const text = mode === 'code' ? extractCode(lastAssistantText) : lastAssistantText;
      if (!text.trim()) return;
      setTyping(true);
      setError(null);
      void window.api.typeText(text);
    },
    [typing, lastAssistantText]
  );

  const cancelTyping = useCallback(() => {
    window.api.cancelTyping();
  }, []);

  // Hotkey from main: ⌃⇧T types the code from last response.
  useEffect(() => {
    // Re-uses the existing onAction infra — but it's only for overlay actions.
    // We listen via a dedicated channel.
    const handler = () => startTyping('code');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).addEventListener('coding-type-last', handler);
    // Bridge from ipcRenderer event 'action:type-last' to a DOM event.
    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).removeEventListener('coding-type-last', handler);
    };
  }, [startTyping]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      send();
    }
  };

  const clear = () => {
    setHistory([]);
    setStreaming('');
    setError(null);
  };

  return (
    <div style={s.container}>
      <div style={s.header}>
        <div style={s.headerLeft}>
          <span style={s.headerIcon}>{'</>'}</span>
          <div>
            <div style={s.headerTitle}>Live Coding Assistant</div>
            <div style={s.headerSubtitle}>Invisible to screen share · ⌃⇧K to toggle</div>
          </div>
        </div>
        <div style={s.headerActions}>
          <div style={s.langToggle} title="Explanation language — switches live, no restart">
            {LANGS.map((lng) => (
              <button
                key={lng}
                style={{ ...s.langBtn, ...(language === lng ? s.langBtnActive : {}) }}
                onClick={() => updateLanguage(lng)}
                title={`${LANGUAGE_LABELS[lng]} — switches live, no restart`}
              >
                {lng.toUpperCase()}
              </button>
            ))}
          </div>
          <button
            style={{ ...s.iconBtn, ...s.captureBtn }}
            onClick={() => void captureNow()}
            title="Add screenshot (⌃⇧S) — press multiple times for multi-page problems"
            disabled={capturing}
          >
            {capturing ? '◌' : '📸'} Capture
          </button>
          {lastAssistantText && !typing && (
            <button
              style={{ ...s.iconBtn, ...s.typeBtn }}
              onClick={() => startTyping('code')}
              title="Type the code from the last response into the focused window (⌃⇧T)"
            >
              ⌨️ Type
            </button>
          )}
          {lastAssistantText && (
            <button
              style={{ ...s.iconBtn, ...s.pinBtn }}
              onClick={() => {
                // Pin the user's last problem + Claude's last answer as test context
                // so the interview overlay can reference it when asked about decisions.
                const lastUser = (() => {
                  for (let i = history.length - 1; i >= 0; i--) {
                    if (history[i].role === 'user') {
                      const c = history[i].content;
                      if (typeof c === 'string') return c;
                      const txt = c.find((p) => p.type === 'text');
                      return txt && txt.type === 'text' ? txt.text : '[screenshot problem]';
                    }
                  }
                  return '';
                })();
                const ctx = `Problem:\n${lastUser}\n\nMy solution / approach:\n${lastAssistantText}`;
                void window.api.setTestContext(ctx);
              }}
              title="Pin this problem + solution as Active Test Context — the interview overlay will use it when asked about your decisions"
            >
              📌 Pin as test
            </button>
          )}
          {typing && (
            <button style={{ ...s.iconBtn, ...s.typeCancelBtn }} onClick={cancelTyping} title="Cancel typing">
              ✕ Stop
            </button>
          )}
          <button style={s.iconBtn} onClick={clear} title="New conversation">
            ↻ New
          </button>
          <button
            style={s.iconBtn}
            onClick={() => window.api.openSettings()}
            title="Settings"
          >
            ⚙
          </button>
        </div>
      </div>

      {solution && (
        <div
          style={{ ...s.solutionBanner, ...(solution.error ? s.solutionBannerError : {}) }}
          title={
            solution.error
              ? `${solution.error}\n${solution.path}`
              : `${solution.path}\n${solution.fileCount} files loaded — change requests are proposed against these real files`
          }
        >
          {solution.error ? (
            solution.fileCount > 0 ? (
              <>
                📦 <strong>{solution.name}</strong> — reload failed ({solution.error}); the
                previously loaded files are still active
              </>
            ) : (
              <>📦 Referenced solution failed to load — check the path in Settings</>
            )
          ) : (
            <>
              📦 Referenced solution: <strong>{solution.name}</strong> ({solution.fileCount} file
              {solution.fileCount === 1 ? '' : 's'}) — ask for the change the interviewer requested
              and I&apos;ll propose it against the real files
            </>
          )}
        </div>
      )}

      {typing && (
        <div style={s.typingBanner}>
          {typeCountdown !== null ? (
            <span>
              ⌨️ Typing in <strong>{typeCountdown}s</strong> — click into the target field NOW
            </span>
          ) : typeProgress ? (
            <span>
              ⌨️ Typing… {typeProgress.typed}/{typeProgress.total} chars
              <div style={s.typingBar}>
                <div
                  style={{
                    ...s.typingBarFill,
                    width: `${(typeProgress.typed / Math.max(1, typeProgress.total)) * 100}%`,
                  }}
                />
              </div>
            </span>
          ) : (
            <span>⌨️ Preparing…</span>
          )}
          <button style={s.bannerCancel} onClick={cancelTyping}>
            Stop (⌃⇧T cancels too)
          </button>
        </div>
      )}

      <div style={s.scrollArea} ref={scrollRef}>
        {history.length === 0 && !streaming && (
          <div style={s.emptyState}>
            <div style={s.emptyIcon}>🧑‍💻</div>
            <div style={s.emptyTitle}>Paste a coding problem</div>
            <div style={s.emptyHint}>
              Paste the question, partial code, or describe what you are stuck on. Claude will
              respond with Approach + Solution + how to explain it.
            </div>
            <div style={s.emptyTip}>
              <kbd style={s.kbd}>⌃</kbd> <kbd style={s.kbd}>↵</kbd> to send
            </div>
          </div>
        )}

        {history.map((m, i) => (
          <Message key={i} role={m.role} content={m.content} />
        ))}
        {streaming && <Message role="assistant" content={streaming} streaming />}
        {error && <div style={s.error}>⚠ {error}</div>}
      </div>

      <div style={s.composer}>
        {stagedImages.length > 0 && (
          <div style={s.stagedImageWrap}>
            <div style={s.stagedImageMeta}>
              <span style={s.stagedImageLabel}>
                📸 {stagedImages.length} screenshot{stagedImages.length === 1 ? '' : 's'} staged
                {stagedImages.length > 1 && ' — sent in order'}
              </span>
              <button style={s.stagedRemoveBtn} onClick={clearStaged}>
                ✕ Clear all
              </button>
            </div>
            <div style={s.stagedStrip}>
              {stagedImages.map((img, idx) => (
                <div key={idx} style={s.stagedThumbWrap}>
                  <img
                    src={`data:${img.mediaType};base64,${img.data}`}
                    alt={`Staged screenshot ${idx + 1}`}
                    style={s.stagedThumb}
                  />
                  <div style={s.stagedThumbIdx}>{idx + 1}</div>
                  <button style={s.stagedThumbRemove} onClick={() => removeStaged(idx)} title="Remove this screenshot">
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={
            stagedImages.length > 0
              ? `Optional: add context (e.g. "use Python"). Press ⌃⇧S again to add more screenshots before sending.`
              : history.length === 0
                ? 'Paste the problem or press ⌃⇧S to capture the screen. Press again to capture more pages of a long problem before sending.\n\nClaude reads the screenshots directly — no need to copy text.'
                : 'Follow-up... e.g. "Make it iterative instead of recursive"'
          }
          rows={stagedImages.length > 0 ? 2 : 4}
          style={s.textarea}
          disabled={busy}
        />
        <div style={s.composerFooter}>
          <span style={s.composerHint}>
            <kbd style={s.kbd}>⌃</kbd>+<kbd style={s.kbd}>↵</kbd> send · <kbd style={s.kbd}>⌃⇧S</kbd> add screenshot
          </span>
          <button
            style={{
              ...s.sendBtn,
              ...(busy || (!input.trim() && stagedImages.length === 0) ? s.sendBtnDisabled : {}),
            }}
            onClick={send}
            disabled={busy || (!input.trim() && stagedImages.length === 0)}
          >
            {busy ? '◌ Thinking…' : 'Send →'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Message({
  role,
  content,
  streaming,
}: {
  role: 'user' | 'assistant';
  content: import('../shared/types').CodingMessageContent;
  streaming?: boolean;
}) {
  if (role === 'user') {
    // content can be string OR an array of parts (text + image)
    if (typeof content === 'string') {
      return (
        <div style={s.userMsg}>
          <div style={s.msgLabel}>You</div>
          <div style={s.userBubble}>{content}</div>
        </div>
      );
    }
    return (
      <div style={s.userMsg}>
        <div style={s.msgLabel}>You</div>
        <div style={s.userBubble}>
          {content.map((part, i) =>
            part.type === 'image' ? (
              <img
                key={i}
                src={`data:${part.mediaType};base64,${part.data}`}
                alt="screenshot"
                style={s.userImage}
              />
            ) : (
              <div key={i} style={{ marginTop: i > 0 ? 8 : 0 }}>{part.text}</div>
            )
          )}
        </div>
      </div>
    );
  }
  // Assistant content is always string
  const text = typeof content === 'string' ? content : '';
  return (
    <div style={s.assistantMsg}>
      <div style={s.msgLabel}>
        Claude {streaming && <span style={s.streamingDot}>●</span>}
      </div>
      <div style={s.assistantContent}>
        <MarkdownRender text={text} />
      </div>
    </div>
  );
}

// Tiny markdown renderer — handles ## headings, ``` code blocks, **bold**, * bullets.
function MarkdownRender({ text }: { text: string }) {
  const blocks = parseMarkdown(text);
  return (
    <>
      {blocks.map((b, i) => {
        if (b.type === 'code') {
          return <CodeBlock key={i} lang={b.lang} code={b.code} />;
        }
        return <ProseBlock key={i} text={b.text} />;
      })}
    </>
  );
}

type ParsedBlock =
  | { type: 'code'; lang: string; code: string }
  | { type: 'prose'; text: string };

function parseMarkdown(text: string): ParsedBlock[] {
  const out: ParsedBlock[] = [];
  const re = /```(\w*)\r?\n?([\s\S]*?)```/g;
  let last = 0;
  let match;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      out.push({ type: 'prose', text: text.slice(last, match.index) });
    }
    out.push({ type: 'code', lang: match[1] || 'text', code: match[2] });
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    // Handle unclosed code block (during streaming)
    const remainder = text.slice(last);
    const unclosedIdx = remainder.indexOf('```');
    if (unclosedIdx !== -1) {
      if (unclosedIdx > 0) {
        out.push({ type: 'prose', text: remainder.slice(0, unclosedIdx) });
      }
      const codePart = remainder.slice(unclosedIdx + 3);
      const langMatch = codePart.match(/^(\w*)\r?\n/);
      const lang = langMatch ? langMatch[1] : 'text';
      const code = langMatch ? codePart.slice(langMatch[0].length) : codePart;
      out.push({ type: 'code', lang: lang || 'text', code });
    } else {
      out.push({ type: 'prose', text: remainder });
    }
  }
  return out;
}

function ProseBlock({ text }: { text: string }) {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let listBuffer: string[] = [];

  const flushList = (key: number) => {
    if (listBuffer.length === 0) return;
    elements.push(
      <ul key={`ul-${key}`} style={s.list}>
        {listBuffer.map((item, i) => (
          <li key={i} style={s.listItem}>
            <InlineMarkdown text={item} />
          </li>
        ))}
      </ul>
    );
    listBuffer = [];
  };

  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('## ')) {
      flushList(i);
      elements.push(
        <h3 key={i} style={s.heading}>
          {trimmed.slice(3)}
        </h3>
      );
    } else if (trimmed.startsWith('# ')) {
      flushList(i);
      elements.push(
        <h2 key={i} style={s.heading2}>
          {trimmed.slice(2)}
        </h2>
      );
    } else if (/^[-*]\s+/.test(trimmed)) {
      listBuffer.push(trimmed.replace(/^[-*]\s+/, ''));
    } else if (trimmed === '') {
      flushList(i);
    } else {
      flushList(i);
      elements.push(
        <p key={i} style={s.paragraph}>
          <InlineMarkdown text={line} />
        </p>
      );
    }
  });
  flushList(lines.length);

  return <>{elements}</>;
}

function InlineMarkdown({ text }: { text: string }) {
  // Handle **bold** and `inline code`
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith('**') && p.endsWith('**')) {
          return (
            <strong key={i} style={{ fontWeight: 600, color: '#fff' }}>
              {p.slice(2, -2)}
            </strong>
          );
        }
        if (p.startsWith('`') && p.endsWith('`')) {
          return (
            <code key={i} style={s.inlineCode}>
              {p.slice(1, -1)}
            </code>
          );
        }
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div style={s.codeBlockWrap}>
      <div style={s.codeHeader}>
        <span style={s.codeLang}>{lang.toUpperCase()}</span>
        <button style={s.codeCopyBtn} onClick={copy}>
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <pre style={s.codeBlock}>
        <code>{code}</code>
      </pre>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  container: {
    fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    background: '#0f1115',
    color: '#e4e4e7',
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 18px',
    background: 'linear-gradient(180deg, #1a1d23 0%, #15171c 100%)',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    flexShrink: 0,
  },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 12 },
  headerIcon: {
    fontSize: 20,
    fontFamily: 'ui-monospace, monospace',
    color: '#a78bfa',
    fontWeight: 700,
  } as React.CSSProperties,
  headerTitle: { fontSize: 14, fontWeight: 600, letterSpacing: '-0.01em' },
  headerSubtitle: { fontSize: 11, opacity: 0.5, marginTop: 1 },
  headerActions: { display: 'flex', gap: 6, alignItems: 'center' },
  langToggle: {
    display: 'flex',
    gap: 2,
    background: 'rgba(0,0,0,0.3)',
    borderRadius: 6,
    padding: 2,
    border: '0.5px solid rgba(255,255,255,0.06)',
  } as React.CSSProperties,
  langBtn: {
    fontSize: 10,
    padding: '4px 7px',
    border: 'none',
    background: 'transparent',
    color: 'rgba(255,255,255,0.5)',
    cursor: 'pointer',
    borderRadius: 4,
    fontWeight: 600,
    letterSpacing: '0.02em',
  } as React.CSSProperties,
  langBtnActive: {
    background: 'rgba(167,139,250,0.25)',
    color: '#c4b5fd',
  } as React.CSSProperties,
  iconBtn: {
    background: 'rgba(255,255,255,0.04)',
    border: '0.5px solid rgba(255,255,255,0.08)',
    color: '#d4d4d8',
    cursor: 'pointer',
    fontSize: 12,
    padding: '5px 10px',
    borderRadius: 6,
  },
  captureBtn: {
    background: 'linear-gradient(180deg, rgba(167,139,250,0.18), rgba(167,139,250,0.10))',
    border: '0.5px solid rgba(167,139,250,0.35)',
    color: '#c4b5fd',
    fontWeight: 600,
  } as React.CSSProperties,
  pinBtn: {
    background: 'linear-gradient(180deg, rgba(251,191,36,0.16), rgba(251,191,36,0.08))',
    border: '0.5px solid rgba(251,191,36,0.30)',
    color: '#fcd34d',
    fontWeight: 600,
  } as React.CSSProperties,
  typeBtn: {
    background: 'linear-gradient(180deg, rgba(34,197,94,0.22), rgba(34,197,94,0.12))',
    border: '0.5px solid rgba(34,197,94,0.4)',
    color: '#86efac',
    fontWeight: 600,
  } as React.CSSProperties,
  typeCancelBtn: {
    background: 'linear-gradient(180deg, rgba(239,68,68,0.22), rgba(239,68,68,0.12))',
    border: '0.5px solid rgba(239,68,68,0.4)',
    color: '#fca5a5',
    fontWeight: 600,
  } as React.CSSProperties,
  solutionBanner: {
    padding: '8px 18px',
    background: 'linear-gradient(90deg, rgba(52,211,153,0.10), rgba(52,211,153,0.03))',
    borderBottom: '0.5px solid rgba(52,211,153,0.2)',
    color: '#6ee7b7',
    fontSize: 11,
    flexShrink: 0,
  } as React.CSSProperties,
  solutionBannerError: {
    background: 'linear-gradient(90deg, rgba(251,191,36,0.12), rgba(251,191,36,0.03))',
    borderBottom: '0.5px solid rgba(251,191,36,0.25)',
    color: '#fcd34d',
  } as React.CSSProperties,
  typingBanner: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    padding: '10px 18px',
    background: 'linear-gradient(90deg, rgba(34,197,94,0.14), rgba(34,197,94,0.06))',
    borderBottom: '0.5px solid rgba(34,197,94,0.3)',
    color: '#bbf7d0',
    fontSize: 12,
    flexShrink: 0,
  } as React.CSSProperties,
  typingBar: {
    height: 4,
    background: 'rgba(255,255,255,0.06)',
    borderRadius: 2,
    marginTop: 4,
    overflow: 'hidden',
  } as React.CSSProperties,
  typingBarFill: {
    height: '100%',
    background: '#22c55e',
    transition: 'width 80ms linear',
  } as React.CSSProperties,
  bannerCancel: {
    background: 'rgba(239,68,68,0.18)',
    border: '0.5px solid rgba(239,68,68,0.35)',
    color: '#fca5a5',
    cursor: 'pointer',
    fontSize: 11,
    padding: '4px 10px',
    borderRadius: 5,
    flexShrink: 0,
  } as React.CSSProperties,
  stagedImageWrap: {
    marginBottom: 10,
    border: '0.5px solid rgba(167,139,250,0.3)',
    borderRadius: 8,
    overflow: 'hidden',
    background: 'rgba(167,139,250,0.06)',
  },
  stagedStrip: {
    display: 'flex',
    gap: 8,
    padding: '8px 10px',
    overflowX: 'auto' as const,
    background: 'rgba(0,0,0,0.2)',
  } as React.CSSProperties,
  stagedThumbWrap: {
    position: 'relative' as const,
    flex: '0 0 auto',
    width: 140,
    height: 100,
    borderRadius: 5,
    overflow: 'hidden',
    border: '0.5px solid rgba(167,139,250,0.4)',
    background: '#000',
  } as React.CSSProperties,
  stagedThumb: {
    width: '100%',
    height: '100%',
    objectFit: 'contain' as const,
    display: 'block',
  } as React.CSSProperties,
  stagedThumbIdx: {
    position: 'absolute' as const,
    top: 4,
    left: 4,
    fontSize: 10,
    fontWeight: 700,
    background: 'rgba(167,139,250,0.85)',
    color: '#fff',
    width: 18,
    height: 18,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  } as React.CSSProperties,
  stagedThumbRemove: {
    position: 'absolute' as const,
    top: 4,
    right: 4,
    width: 18,
    height: 18,
    borderRadius: '50%',
    background: 'rgba(0,0,0,0.7)',
    color: '#fca5a5',
    border: 'none',
    cursor: 'pointer',
    fontSize: 10,
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
  } as React.CSSProperties,
  stagedImageMeta: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '6px 10px',
    fontSize: 11,
  },
  stagedImageLabel: { color: '#c4b5fd', fontWeight: 500 },
  stagedRemoveBtn: {
    background: 'transparent',
    border: 'none',
    color: '#fca5a5',
    cursor: 'pointer',
    fontSize: 11,
    padding: 2,
  } as React.CSSProperties,
  userImage: {
    maxWidth: '100%',
    maxHeight: 240,
    borderRadius: 6,
    objectFit: 'contain' as const,
    display: 'block',
    background: '#000',
  } as React.CSSProperties,
  scrollArea: {
    flex: 1,
    overflowY: 'auto',
    padding: '16px 18px',
  } as React.CSSProperties,
  emptyState: {
    textAlign: 'center' as const,
    padding: '60px 24px',
    color: 'rgba(255,255,255,0.5)',
  },
  emptyIcon: { fontSize: 40, marginBottom: 16 },
  emptyTitle: { fontSize: 16, fontWeight: 500, marginBottom: 6, color: 'rgba(255,255,255,0.85)' },
  emptyHint: { fontSize: 12, opacity: 0.7, maxWidth: 380, margin: '0 auto', lineHeight: 1.5 },
  emptyTip: { fontSize: 11, marginTop: 18, opacity: 0.5 },
  userMsg: { marginBottom: 18 },
  assistantMsg: { marginBottom: 24 },
  msgLabel: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    opacity: 0.5,
    marginBottom: 6,
  },
  userBubble: {
    background: 'rgba(99,102,241,0.12)',
    border: '0.5px solid rgba(99,102,241,0.25)',
    padding: '10px 14px',
    borderRadius: 10,
    fontSize: 13,
    lineHeight: 1.55,
    whiteSpace: 'pre-wrap' as const,
  } as React.CSSProperties,
  assistantContent: {
    fontSize: 14,
    lineHeight: 1.65,
  },
  streamingDot: {
    color: '#a78bfa',
    animation: 'pulse 1s infinite',
    marginLeft: 4,
  } as React.CSSProperties,
  heading: {
    fontSize: 13,
    fontWeight: 700,
    color: '#a78bfa',
    margin: '20px 0 8px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
  } as React.CSSProperties,
  heading2: { fontSize: 16, fontWeight: 600, margin: '20px 0 8px', color: '#fff' },
  paragraph: { margin: '0 0 10px' },
  list: { margin: '0 0 12px 0', paddingLeft: 18 },
  listItem: { marginBottom: 4 },
  codeBlockWrap: {
    margin: '10px 0 14px',
    borderRadius: 8,
    overflow: 'hidden',
    border: '0.5px solid rgba(255,255,255,0.08)',
    background: '#0a0b0e',
  },
  codeHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '6px 12px',
    background: 'rgba(255,255,255,0.03)',
    borderBottom: '0.5px solid rgba(255,255,255,0.05)',
    fontSize: 10,
  },
  codeLang: {
    fontWeight: 600,
    letterSpacing: '0.08em',
    color: '#a78bfa',
    fontFamily: 'ui-monospace, monospace',
  } as React.CSSProperties,
  codeCopyBtn: {
    background: 'rgba(255,255,255,0.06)',
    border: '0.5px solid rgba(255,255,255,0.1)',
    color: '#d4d4d8',
    cursor: 'pointer',
    fontSize: 11,
    padding: '3px 8px',
    borderRadius: 4,
  },
  codeBlock: {
    margin: 0,
    padding: '12px 14px',
    fontFamily: '"JetBrains Mono", "Fira Code", ui-monospace, Consolas, monospace',
    fontSize: 12.5,
    lineHeight: 1.55,
    color: '#e8e8e8',
    overflowX: 'auto' as const,
    whiteSpace: 'pre' as const,
  } as React.CSSProperties,
  inlineCode: {
    fontFamily: 'ui-monospace, Consolas, monospace',
    fontSize: 12,
    background: 'rgba(167,139,250,0.12)',
    color: '#c4b5fd',
    padding: '1px 5px',
    borderRadius: 3,
  } as React.CSSProperties,
  composer: {
    padding: '12px 14px',
    background: 'linear-gradient(180deg, #15171c, #12141a)',
    borderTop: '1px solid rgba(255,255,255,0.06)',
    flexShrink: 0,
  },
  textarea: {
    width: '100%',
    boxSizing: 'border-box' as const,
    padding: '10px 12px',
    background: 'rgba(0,0,0,0.3)',
    border: '0.5px solid rgba(255,255,255,0.1)',
    borderRadius: 8,
    color: '#e4e4e7',
    fontSize: 13,
    fontFamily: '"JetBrains Mono", ui-monospace, Consolas, monospace',
    lineHeight: 1.5,
    resize: 'vertical' as const,
    outline: 'none',
  } as React.CSSProperties,
  composerFooter: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  composerHint: { fontSize: 11, opacity: 0.5 },
  kbd: {
    fontSize: 10,
    padding: '1px 5px',
    borderRadius: 3,
    background: 'rgba(255,255,255,0.06)',
    border: '0.5px solid rgba(255,255,255,0.1)',
    fontFamily: 'ui-monospace, monospace',
    margin: '0 2px',
  } as React.CSSProperties,
  sendBtn: {
    padding: '7px 16px',
    fontSize: 12,
    fontWeight: 600,
    background: 'linear-gradient(180deg, #a78bfa, #8b5cf6)',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    boxShadow: '0 1px 3px rgba(0,0,0,0.3), 0 0 12px rgba(139,92,246,0.15)',
  },
  sendBtnDisabled: {
    background: 'rgba(255,255,255,0.06)',
    color: 'rgba(255,255,255,0.3)',
    cursor: 'not-allowed',
    boxShadow: 'none',
  } as React.CSSProperties,
  error: {
    padding: '10px 14px',
    margin: '10px 0',
    color: '#fca5a5',
    fontSize: 12,
    background: 'rgba(239,68,68,0.08)',
    border: '0.5px solid rgba(239,68,68,0.2)',
    borderRadius: 6,
  },
};
