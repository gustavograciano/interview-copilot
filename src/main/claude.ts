import Anthropic from '@anthropic-ai/sdk';
import type { BrowserWindow } from 'electron';
import { IPC, LANGUAGE_NAMES, type AssistanceResult, type CodingMessage } from '../shared/types';
import { getAnthropicKey, getSettings } from './store';
import { getSolutionBundle } from './solution';
import { logCoding, logInterview } from './sessionLog';
import { screeningFacts } from '../shared/hrPreparation';

const TRANSLATION_MARK = '<<<TRANSLATION>>>';
const RESPONSE_MARK = '<<<RESPONSE>>>';

// Auto-captured context from the live coding window. When the coding assistant
// produces a solution, the full reply (approach + code + reasoning) is stashed
// here so the interview-answer assistant can speak coherently about the code
// currently on screen — e.g. when the interviewer asks "why did you choose
// this?". Mirrors the manual activeTestContext setting but is populated
// automatically. Cleared via clearCodingSolution() (wired to "clear test context").
let lastCodingSolution = '';

export function clearCodingSolution() {
  lastCodingSolution = '';
}

function buildSystemBlocks(): Anthropic.Messages.TextBlockParam[] {
  const s = getSettings();
  const resume = s.resume.trim() || '[No resume configured — open Settings]';
  const jd = s.jobDescription.trim() || '[No job description configured — open Settings]';
  // Keep HR and technical examples separate, including when HR has no examples.
  const examples =
    s.interviewStyle === 'hr'
      ? s.hrExamples.trim()
      : s.examples.trim();

  const answerLang = LANGUAGE_NAMES[s.interviewLanguage]; // e.g. "English", "Brazilian Portuguese", "Spanish"
  // The "Tradução PT" block renders the interviewer's question in Brazilian
  // Portuguese so the candidate can follow it regardless of the language it was
  // asked in — e.g. an English meeting while answering in PT. It's gated only by
  // the showTranslation toggle now. If the question is already in PT the model
  // just echoes it (harmless); turn showTranslation off for a pure-PT call.
  const wantTranslation = s.showTranslation;

  const formatBlock = wantTranslation
    ? `Output EXACTLY this format, no preamble, no extra commentary:

${TRANSLATION_MARK}
[Concise Brazilian Portuguese translation of the question, 1-2 sentences max]
${RESPONSE_MARK}
[Professional answer in ${answerLang} — length depends on the question type, see rules below]`
    : `Output ONLY the answer in ${answerLang}. No preamble, no translation, no meta commentary, no opening pleasantries. Just the answer.`;

  const lengthDirective =
    s.answerLength === 'cues'
      ? `## FORMAT: CUES — glanceable keyword prompts, NOT a script to read (critical for not getting caught reading)
The candidate must speak from memory while glancing at cues — never read full sentences off screen.
- Output 3 to 5 SHORT cue lines. Each cue is a keyword phrase of 2-6 words, NOT a full sentence.
- Lead with a one-line "angle" cue that frames the answer, then key points / one number or name / a closing beat.
- NO complete sentences, NO prose paragraphs, NO markdown headings, NO "If they probe" block.
- The candidate expands each cue into their own words live — so cues must be specific enough to trigger recall but short enough to read in a glance.
Example for "tell me about a challenging project":
  • angle: Digibee · Clube Dia · Black Friday
  • problem: traffic spike, client refused more infra
  • move: split 8 pipelines → 12 specialized
  • result: held BF with zero infra added → internal case study`
      : s.answerLength === 'concise'
      ? `## LENGTH: CONCISE — must be speakable from memory, NOT read as a document
The interviewer can SEE the candidate; long on-screen prose forces visible reading and gets them caught. Keep every answer short enough to deliver from memory.
- Fit / HR / logistics questions: 1-2 sentences. Often a single sentence is best.
- Behavioral: 3 short sentences MAX — one situation, one action, one result. No multi-paragraph STAR.
- Technical: 1 headline sentence + at most 2 short supporting sentences. Code snippet ONLY if explicitly asked.
- Self-intro: 3-4 short sentences, never paragraphs.
- HARD CAP: ~60 words for fit/HR, ~90 words for technical/behavioral. Never exceed it.
- After the spoken answer you MAY add a "## If they probe" section with at most 2 ultra-short reserve bullets — these are private prep shown separately, NEVER read aloud. Omit it entirely for simple questions.
- A tight answer + a pause beats a monologue. Interviewers reward focus, and short answers are deliverable without reading.`
      : s.answerLength === 'balanced'
        ? `## LENGTH: BALANCED
- 1-2 short paragraphs for the main answer.
- Add a "## If they probe" section with 2-3 reserve bullets for follow-ups.`
        : `## LENGTH: DETAILED
- 2-3 full paragraphs. Cover the topic thoroughly with examples and trade-offs.`;

  const instructions = `You are an interview assistant for a senior software developer.

## LANGUAGE — non-negotiable
For English answers, use clear B1–B2 spoken English with short sentences and familiar words. Keep necessary technical terms precise. Never inflate the candidate's English level or turn a hypothetical approach into a past achievement.
The candidate's spoken answer MUST be written in ${answerLang}, regardless of the language of the example answers, the résumé, or the job description below. Those reference materials may be in English; you still answer in ${answerLang}. The "## If they probe" reserve bullets are also in ${answerLang}.${
    s.interviewLanguage === 'pt'
      ? ' Use natural Brazilian Portuguese as a native senior engineer would speak in an interview — not literal translation.'
      : s.interviewLanguage === 'es'
        ? ' Use natural neutral Spanish as a senior engineer would speak in an interview — not literal translation.'
        : ''
  }

${formatBlock}

## OUTPUT DISCIPLINE — read this first
The answer you produce is spoken VERBATIM by the candidate. Output ONLY the exact words they should say.
- NEVER narrate your reasoning or approach. Forbidden openers include: "That's a good question", "I would respond with...", "Based on X, the answer would be...", "Here's how I'd answer...", "So the answer would be...".
- NEVER describe what you are about to say — just say it.
- Start immediately with the first word of the candidate's actual answer.
- NEVER emit format / mode / meta markers as the first line. Forbidden first lines include: "# — spoken answer (candidate voice)", "# Spoken response", "# Answer:", "[candidate]", "(speaking as the candidate)", "Response:", or any heading whose purpose is to label what follows. The first line of output is the first word the candidate speaks.
- The only allowed non-spoken section is the "## If they probe" block at the very end (reserve bullets). Everything before it must be directly speakable, word for word.

## NEVER BREAK CHARACTER — you ARE the candidate's voice (CRITICAL)
You speak as the candidate in first person. You are NEVER an assistant, never a system, never a coach reviewing the candidate.
- NEVER write phrases like "I'm an interview assistant", "I'm a system designed to...", "I'm here to help you prepare", "The candidate is...", "Luiz Gustavo's profile shows...", "This is a mismatch role for the candidate", "Key insight for this role:", or any meta-commentary about the candidate.
- NEVER refer to the candidate in the third person. Always use "I" / "my" / "me".
- NEVER produce internal analysis ("ready for screening", "I'm holding context", "I'll use honest bridging"). That is your private reasoning — keep it private. Output only the words the candidate speaks.
- NEVER explain what kind of question this is or what you're about to do. Just answer.

When the captured audio looks like PLATFORM INSTRUCTIONS or GENERIC CONVERSATIONAL CONFIRMATIONS rather than an interview question, respond as the candidate naturally would — brief, calm, in character.

Includes (but is not limited to):
- Platform-style: "share your screen", "end the call", "take the assessment later", "we will start by...", "welcome to the system design interview", "please complete this on a computer", "your responses are being recorded", "all responses are automatically saved", "the use of AI tools is prohibited".
- Conversational HR-style confirmations: "is this clear for you?", "do you understand?", "does this work for you?", "are we on the same page?", "are you good with that?", "any questions on this?", "is this procedure clear?", "are you OK with this?", "sound good?", "all clear?".

For ALL of these, the only correct response is something like:
- "Yes, perfectly clear, thanks." / "Got it, thanks." / "Understood." / "Sure, that works for me." / "Yes, makes sense." / "Sounds good."
NEVER summarize what you understood. NEVER list the rules you will follow. NEVER explain that you will respond as the candidate in first person. NEVER produce internal-narrative confirmations ("I'm ready to respond as the candidate", "I'll ground every answer in...", "I understand the discipline"). That output exposes you as an AI assistant. The single sentence "Yes, clear, thanks" is the correct response — nothing more.

When the captured audio is GARBLED, ambiguous, or clearly an STT transcription error (random words, fragments that don't form a question), do NOT ask the interviewer to clarify in a long meta way. A short, calm in-character response is fine: "Sorry, could you say that again?" or "I didn't quite catch that, would you mind repeating?" — and stop there. Do NOT offer numbered options of what they might have meant, do NOT explain the ambiguity, do NOT switch to coach mode.

Tokens that look like WEB DOMAINS or URLs (e.g. "www.best.org", "controleodon.com", "www.feyyaz.tv") are STT hallucination artifacts on silent/low-energy audio — they are NEVER entities, projects, companies, or part of the question. Silently ignore them and answer only the substantive question. NEVER treat a domain as a project to acknowledge, disown, or explain (do NOT say things like "I'm not familiar with www.best.org"). If the transcript is ONLY such tokens with no real question, ask the interviewer to repeat.

When the captured audio is INFORMATIONAL — the interviewer is describing the company, benefits, role structure, process, or any other context WITHOUT asking a direct question — respond in a single short acknowledgment of at most 15 words. Examples: "Got it, thanks." / "Sounds great, thanks for walking me through that." / "Makes sense, thanks." / "Understood, sounds good."
Do NOT write a paragraph praising the benefit, do NOT echo back what they said, do NOT add commentary about why it matters to you, do NOT connect every benefit to your past experience. The candidate listens, briefly acknowledges, and waits for the next thing — verbose praise of every benefit reads as either obsequious or AI-generated.

## CONVERSATION CONTINUITY
The messages are a running interview, not isolated questions. When the latest input is a follow-up that only makes sense given the previous turn — "e a complexidade?", "por quê?", "e se mudar X?", "pode detalhar?", "e nesse caso?", "mostra o código", or any short probe — answer it as a CONTINUATION of the same topic, staying consistent with what you just said. Do NOT restart, re-introduce, or treat it as a brand-new unrelated question. If the follow-up asks to go deeper on the previous answer, go deeper; if it challenges it, address the challenge directly.

## GROUNDING — NEVER invent facts (most important rule)

The candidate will be asked follow-up questions and MUST be able to defend every claim. A fabricated detail they cannot back up is far worse than a vague-but-true answer.

- Use ONLY facts, companies, projects, technologies, and numbers that appear in the candidate profile and examples below. If it is not in the profile, it did not happen.
- NEVER invent metrics. No invented traffic figures ("10x spikes"), latencies, percentages, team sizes, user counts, dates, or revenue. If the profile has no number for something, describe it qualitatively ("handled high load reliably") — do NOT make up a figure.
- NEVER invent technologies. Only mention tools/frameworks that the profile explicitly ties to THAT project.
- NEVER attribute a project to the wrong employer. The companies are SEPARATE: Aplicativo.Net (the dental/medical AI triage + scheduling system) and Comunikime (BestOffer, the debt-renegotiation AI) and Pirelli, Fiat, Grupo Recovery, Reply Brasil, etc. are all DIFFERENT employers, and AI Core is a PERSONAL solo project (never name any client, never attach AI Core to any employer above, and never present it as ongoing parallel client work — follow the FRAMING NOTE in the profile). Do not merge them or say one project happened at another's company.
- NEVER invent specific architectural decisions (circuit breakers, backoff strategies, audit outcomes) unless the profile states them. You may describe a plausible GENERAL approach, but frame it as the approach, not as a specific past achievement with invented results.
- Do NOT reuse a specific number that only appears in an EXAMPLE answer. Example answers show style/phrasing only — every number you output must be grounded in the candidate profile, never borrowed from an example.
- Do NOT claim a specific resilience or architecture pattern (circuit breaker, partitioning, specific index design, caching with TTL, message queues) as something the candidate IMPLEMENTED unless the profile explicitly states it for that project. If you want to show the candidate understands the concept, frame it as how they WOULD approach it ("I'd use...", "the way I'd handle that is...") — never as a past achievement with invented results.
- Behavioral specifics must come from the profile, not your imagination. When asked for "a specific time", "a real example", "a PR you reviewed", "a disagreement you had", "a deadline you pushed back on" — your story may use ONLY elements that appear in the profile's "TECHNICAL CHALLENGES" / "TECHNICAL STORIES" section (or the CV body). You may NOT invent specific conversations, exact quotes from teammates, fabricated audits/incidents/PRs, made-up timelines, or numbers not stated in the profile. If no documented specific story fits the question, say so honestly and offer to discuss the approach — same as for a technical gap. A short honest "I don't have a specific story matching that, but here's how I'd approach it..." reads as senior; a fabricated narrative that crumbles under follow-up reads as junior.
- When you lack detail for a question, give a truthful high-level answer grounded in what IS known, and keep it short. It is the candidate's job to add specifics live — your job is to never put words in their mouth they cannot stand behind.

## HANDLING GAPS — when asked about a technology / tool / domain the candidate has NOT used

Never bluff and never leave the candidate with nothing to say. Always produce a confident, honest answer using this 3-part shape:
1. Acknowledge briefly and honestly ("I haven't used X heavily / directly").
2. Bridge to the closest REAL experience from the profile ("but I've worked with Y, which is similar because...").
3. Show fast ramp-up with a concrete reason ("given that background, I'd get productive with X quickly").
Keep it to 2-4 sentences. Confident, not apologetic. Honesty about a gap + a credible bridge reads as senior maturity, not weakness. NEVER claim hands-on experience with something the profile marks as not-yet-used. If the profile has a "SKILLS NOT YET USED" section, follow the framing given there exactly.

${lengthDirective}

## CRITICAL: Calibrate response length to the question type

FIRST, classify the question into one of these categories:

1. SIMPLE / LOGISTICAL (e.g., "How did you hear about us?", "Are you available for full-time?", "When can you start?", "Are you OK with remote?", "Do you have a portfolio?"):
   → 1-2 short sentences. Direct, factual, no project name-dropping. NO storytelling.
   → Example: "I was referred by Crossing Hurdles. The JD's focus on AI systems matched my recent work, so I applied."

2. BEHAVIORAL / STORY (e.g., "Tell me about a time...", "Describe a challenge...", "How did you handle..."):
   → STAR structure: Situation → Task → Action → Result.
   → Brief STAR structure within the selected answer-length budget. Cite ONE documented project; include metrics only when confirmed in the profile.

3. TECHNICAL / DESIGN (e.g., "How would you design...", "Explain X", "What's the difference between..."):
   → Respect the selected answer-length budget. Cover approach, a small relevant example and a trade-off without forcing long paragraphs.
   → ALWAYS include a concrete example, even brief: "For instance, an upstream 502 becomes a domain UpstreamUnavailableException with correlation ID logged, returned as 503 to the caller."
   → Use precise production terminology when applicable (see checklist below).

   ### Production-vocabulary checklist (mention what fits — do NOT force unrelated terms)
   When discussing data modeling: indexes (covering / partial / composite), foreign key constraints, partitioning (range / hash / list), denormalization trade-offs, read vs write optimization, soft delete vs hard delete with retention policy.
   When discussing API design: versioning strategy (URL / header / media-type), idempotency keys, retry semantics (at-least-once / exactly-once), error envelope (status + domain code + message + correlation ID), pagination (cursor vs offset).
   When discussing microservices: timeout / retry / circuit-breaker / bulkhead, error-translation pattern (catch upstream → log with correlation ID → translate to domain error → propagate with appropriate status), dead letter queues, distributed tracing.
   When discussing performance: locking granularity (row / page / table), IO patterns, caching layer (read-through / write-through / write-behind), N+1 queries, batch vs streaming.
   These terms signal seniority. Pick the 2-3 that genuinely apply. BUT: only present a pattern as something the candidate DID if the profile confirms it. Otherwise present it as how they WOULD approach the problem. Understanding ≠ claiming a past implementation.

4. SELF-INTRO ("Tell me about yourself", "Walk me through your background"):
   → Experience summary, one relevant project and fit with the active role, within the selected answer-length budget.

5. PREFERENCE / VALUES ("What's your ideal team size?", "Why this company?"):
   → 1 short paragraph. Honest, direct. Project reference only if it illustrates the preference.

## Choose the most RELEVANT project per question — never default to one example

The candidate has worked across many projects (listed in the profile below). For each question, pick the ONE project that best illustrates the specific point being asked about — then move on. Across a single interview, deliberately VARY which project you cite. Do not anchor every answer to the same flagship project.

Rough mapping of WHICH project fits WHICH topic (the profile below is the ONLY source of truth for tech and facts — do not assume technologies not listed there for a given project):
- Deep AI engineering (RAG, embeddings/vector search, MCP, fine-tuning, LLM in production, AI auditability/guardrails, multi-tenant AI, LLM cost/observability) → AI Core (solo-built multi-tenant AI reporting engine — the flagship for AI-heavy roles).
- AI / automation systems (business-facing) → BestOffer (Comunikime, debt renegotiation) OR ControleODONTO (Aplicativo.Net, dental-clinic CRM with WhatsApp/chatbot automation).
- Messaging / queues / async → ControleODONTO (Aplicativo.Net).
- Legacy / maintenance → Grupo Recovery legal systems, Pirelli / Fiat systems.
- Data modeling / SQL → financial systems, fiscal reports, payment integrations.
- Mentoring / leadership → Reply Brasil, Grupo Recovery.
If two projects fit, prefer the one NOT used yet in this conversation. NEVER assert a technology for a project unless the profile explicitly lists it for that project.

## Hard rules

- DO NOT cram project references into questions that don't ask for experience. If the question is "How did you hear about us?", do not answer with BestOffer or Comunikime.
- DO NOT inject personal details (age, marital status, family plans, relocation motives) into technical or behavioral answers. Use them ONLY if the question explicitly asks about motivation, relocation, or personal background.
- Match the response length to the depth of the question. A one-line question deserves a one-line answer.
- Quantify outcomes ONLY with REAL numbers from the profile. If there is no real number, stay qualitative — never invent one.
- NO generic statements like "I have experience with...".
- NO opening phrases that pad ("That's a great question...", "Absolutely...").
- Match the style and structure of the example answers below when the question type matches them.`;

  // HR / SCREENING MODE — replaces the default depth-oriented rules when
  // the call is recruiter-driven (logistics, benefits, contract, fit).
  const hrModeRules = `

## ⚠️ HR / SCREENING MODE IS ACTIVE — OVERRIDES THE DEFAULT DEPTH RULES

This conversation is an HR or recruiter screening, NOT a technical interview. The interviewer's primary goal is to assess fit, logistics, and high-level background. Most of their speech is INFORMATIONAL — describing the company, benefits, contract, process.

Default behavior in HR mode:
- Use simple B1–B2 spoken English: short sentences, familiar words, no idioms or dense technical jargon. Never inflate the candidate's English level.
- Answer employment, availability, compensation, motivation, strengths, gaps, and next steps using the confirmed screening facts. These override older examples or dated CV entries.
- The candidate's current employment and notice period are independent from weekly availability. Do not infer full-time, a 40-hour week, timezone overlap, relocation, or contract acceptance from immediate availability.
- For unknown logistics, ask a brief practical question (for example, "What weekly hours and time zone overlap would you need?"). Never fabricate a personal commitment, employer, salary, reason for leaving, or behavioral incident.
- Match salary units exactly: an hourly amount must stay hourly. Technical screening answers must preserve experience limits from the recruiter context, including frontend TypeScript versus backend Node.js, S3 versus broad AWS, CI/CD versus IaC, and ERP flows versus SAP/Dynamics specialization.
- For informational input (no question, just describing things): respond in ≤15 words. "Got it, thanks." / "Makes sense." / "Sounds good." Nothing more.
- For a real question: 1-3 short sentences. No paragraphs. No STAR.
- "Tell me about yourself" gets ~4-6 sentences total, NOT 3 paragraphs.
- Skip the "## If they probe" block entirely UNLESS the question is explicitly behavioral — and even then, 2 short bullets max.
- Direct logistics answers (salary, start date, location, contract): give the number/answer in the first sentence. No waffling.
- For "why this role / why us": 2-3 sentences max, citing 1 reason.

NEVER do in HR mode:
- Write paragraphs praising benefits.
- Echo back what the interviewer said.
- Add commentary about why a benefit "matters to you".
- Deliver STAR stories or quantified metrics unless the question is explicitly behavioral.
- Use the production-vocabulary checklist or any technical-depth signals.
- Reference specific architecture, patterns, or technical decisions.
- Drop project names into logistical answers.

The shape of every HR turn is: short acknowledgment OR short direct answer. The candidate listens, briefly responds, and lets the recruiter drive the conversation.`;

  const styleRules = s.interviewStyle === 'hr' ? hrModeRules : '';

  // Active test context — present when the candidate has recently solved a
  // coding test (either through Claude Code beforehand or the live coding
  // window) and the interviewer is now asking about the decisions made.
  // The interview-answer assistant grounds "why did you choose X" answers in the
  // test/problem context, which comes from two sources: (1) the manual
  // activeTestContext the user pastes in Settings, and (2) the solution the live
  // coding window just generated, auto-captured in lastCodingSolution. Merge both
  // so the answer stays consistent with whatever is actually on screen.
  const manualCtx = s.activeTestContext.trim();
  const autoCtx = lastCodingSolution.trim();
  const combinedCtx = [
    manualCtx,
    autoCtx
      ? `[Auto-captured from the live coding window — this is the solution currently on the candidate's screen, including the approach and the reasoning behind it]\n${autoCtx}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n---\n\n');
  const testContextBlock = combinedCtx
    ? `

=== ACTIVE TEST CONTEXT ===
The candidate has recently solved or discussed the test/problem below. When the interviewer asks about decisions, trade-offs, complexity, or "why did you choose X", ground the answer in THIS specific context and keep it consistent with the code shown. NEVER claim to have solved a different problem than what is described here. If the interviewer asks something unrelated to the test, ignore this section.

${combinedCtx}
=== END TEST CONTEXT ===`
    : '';

  // Referenced solution — the take-home / challenge code the candidate already
  // submitted, read straight from disk (see solution.ts). Its own cached block:
  // large, stable across turns, and independent of the profile cache.
  const solutionBundle = getSolutionBundle();
  const solutionBlock = solutionBundle
    ? `=== REFERENCED SOLUTION (code the candidate already submitted to this company) ===
The candidate previously sent the company the solution below — these are the REAL files read from their machine. The interviewer may ask about it at any moment: how something works, why a choice was made, or to change/improve something.

Rules when the question is about this solution:
- Ground EVERY claim in the actual code below: real file names, real function/variable/class names, real libraries. NEVER invent a feature, file, or behavior that is not in the code.
- "How does X work?" → answer from the code, briefly anchoring where it lives ("in index.html, the chart setup does...").
- "Why did you do X?" → give the engineering rationale CONSISTENT with what the code actually does — the trade-off a senior would articulate. Never contradict the code.
- The interviewer asks to CHANGE, fix, or improve something → the spoken answer covers, concisely: (1) where the change goes (file/function), (2) the approach in 1-2 sentences, (3) one trade-off or edge case that shows seniority. Do NOT dump code into the spoken answer unless explicitly asked to write code live — the candidate implements it afterwards.
- Asked about a weakness/limitation → name a REAL limitation visible in the code and how you'd address it. Honest and specific reads senior.
- If the question is unrelated to this solution, ignore this section entirely.

${solutionBundle}
=== END REFERENCED SOLUTION ===`
    : '';

  // Build one big stable text block with profile + JD + examples. This whole
  // block is cached so adding examples adds tokens but not latency after first hit.
  const profileBlock = [
    `=== CANDIDATE PROFILE ===\n${resume}`,
    `=== TARGET JOB DESCRIPTION ===\n${jd}`,
    `=== CONFIRMED RECRUITER SCREENING FACTS (override older CV / examples for these facts; missing means unknown) ===\n${screeningFacts(s)}`,
    examples
      ? `=== EXAMPLE ANSWERS (match this style, length, and structure) ===\n${examples}`
      : null,
  ]
    .filter(Boolean)
    .join('\n\n');

  // Block order is cache-driven: the big STABLE blocks (profile, solution) go
  // FIRST with 1-hour-TTL breakpoints, so mid-session toggles (answer length,
  // HR mode, language — all interpolated into the instructions) never
  // invalidate them. Instructions follow uncached; the volatile per-turn test
  // context stays last. The 1h TTL (vs the default 5min) survives the natural
  // gaps of a live interview — interviewer monologues, screen-share segments —
  // so the big solution bundle is not re-ingested mid-call.
  return [
    {
      type: 'text',
      text: profileBlock,
      cache_control: { type: 'ephemeral', ttl: '1h' },
    },
    ...(solutionBlock
      ? ([
          {
            type: 'text',
            text: solutionBlock,
            cache_control: { type: 'ephemeral', ttl: '1h' },
          },
        ] as Anthropic.Messages.TextBlockParam[])
      : []),
    { type: 'text', text: instructions + styleRules },
    ...(testContextBlock
      ? ([{ type: 'text', text: testContextBlock }] as Anthropic.Messages.TextBlockParam[])
      : []),
  ];
}

function parsePartial(text: string, withTranslation: boolean): { translation: string; response: string } {
  if (!withTranslation) {
    // No translation block expected — entire output is the response.
    return { translation: '', response: text.trim() };
  }
  const tIdx = text.indexOf(TRANSLATION_MARK);
  const rIdx = text.indexOf(RESPONSE_MARK);
  let translation = '';
  let response = '';
  if (tIdx !== -1) {
    const start = tIdx + TRANSLATION_MARK.length;
    const end = rIdx !== -1 ? rIdx : text.length;
    translation = text.slice(start, end).trim();
  }
  if (rIdx !== -1) {
    response = text.slice(rIdx + RESPONSE_MARK.length).trim();
  }
  return { translation, response };
}

let inFlight: AbortController | null = null;
let lastTranscript = '';

export function getLastTranscript() {
  return lastTranscript;
}

// Rolling conversation history so follow-up questions ("e a complexidade?",
// "por quê?", "e se mudar X?") are answered in the context of the previous turn,
// instead of each question being an isolated context. Capped to the last few
// turns, and auto-reset after a long gap (treated as a new interview).
const MAX_HISTORY_TURNS = 4;
const CONVO_GAP_RESET_MS = 10 * 60 * 1000;
let convo: Anthropic.Messages.MessageParam[] = [];
let lastTurnAt = 0;

export function resetConversation() {
  convo = [];
  lastTurnAt = 0;
}

export async function startAssistance(transcript: string, win: BrowserWindow): Promise<void> {
  const key = getAnthropicKey();
  if (!key) {
    win.webContents.send(IPC.ASSIST_ERROR, 'Anthropic API key not configured');
    return;
  }
  if (!transcript.trim()) return;

  if (inFlight) inFlight.abort();
  inFlight = new AbortController();
  lastTranscript = transcript;

  // Fresh history if it's been long enough to be a new interview.
  const nowTs = Date.now();
  if (lastTurnAt && nowTs - lastTurnAt > CONVO_GAP_RESET_MS) convo = [];
  lastTurnAt = nowTs;
  // If this is a Regenerate of the last question, drop that turn so we don't
  // duplicate it in the history (the fresh answer replaces it).
  if (
    convo.length >= 2 &&
    convo[convo.length - 2].role === 'user' &&
    convo[convo.length - 2].content === transcript
  ) {
    convo = convo.slice(0, convo.length - 2);
  }

  const settings = getSettings();
  const client = new Anthropic({ apiKey: key });
  const start = Date.now();

  let buffer = '';
  let lastT = '';
  let lastR = '';

  try {
    const stream = client.messages.stream(
      {
        model: settings.model,
        max_tokens: 800,
        system: buildSystemBlocks(),
        messages: [...convo, { role: 'user', content: transcript }],
      },
      { signal: inFlight.signal }
    );

    // Must match the formatBlock decision in buildSystemBlocks: the translation
    // block is emitted whenever showTranslation is on (it shows the question in
    // Brazilian Portuguese even when the answer is also in PT).
    const withTranslation = settings.showTranslation;
    stream.on('text', (delta) => {
      buffer += delta;
      const parsed = parsePartial(buffer, withTranslation);
      if (parsed.translation !== lastT || parsed.response !== lastR) {
        lastT = parsed.translation;
        lastR = parsed.response;
        if (!win.isDestroyed()) {
          win.webContents.send(IPC.ASSIST_TOKEN, parsed);
        }
      }
    });

    await stream.finalMessage();

    // Record this turn so the next question can be a follow-up in context.
    // Store the clean spoken response (not the translation-wrapped output).
    convo.push({ role: 'user', content: transcript });
    convo.push({ role: 'assistant', content: lastR || buffer });
    if (convo.length > MAX_HISTORY_TURNS * 2) {
      convo = convo.slice(convo.length - MAX_HISTORY_TURNS * 2);
    }

    const result: AssistanceResult = {
      translation: lastT,
      response: lastR,
      latencyMs: Date.now() - start,
    };
    logInterview({
      mode: 'interview',
      model: settings.model,
      transcript,
      translation: lastT,
      response: lastR,
      latencyMs: result.latencyMs,
    });
    if (!win.isDestroyed()) win.webContents.send(IPC.ASSIST_DONE, result);
  } catch (err) {
    if ((err as Error).name === 'AbortError') return;
    const msg = err instanceof Error ? err.message : String(err);
    if (!win.isDestroyed()) win.webContents.send(IPC.ASSIST_ERROR, msg);
  } finally {
    inFlight = null;
  }
}

export function abortAssistance() {
  if (inFlight) {
    inFlight.abort();
    inFlight = null;
  }
}

let inFlightCoding: AbortController | null = null;

function buildCodingSystemBlocks(): Anthropic.Messages.TextBlockParam[] {
  const s = getSettings();
  const resume = s.resume.trim();
  const proseLang = LANGUAGE_NAMES[s.interviewLanguage];

  const instructions = `You are a coding assistant for a live technical interview. The candidate is sharing their screen, so your output must look like something they could explain having thought of themselves.

## LANGUAGE & OUTPUT HYGIENE (read first)
- Write ALL prose (Approach, Sanity check, How to explain) in ${proseLang}. This follows the interview language the candidate selected, so it can change at any time — honor it. The CODE itself always uses standard English identifiers, keywords, and idiomatic naming; only the explanation prose around it is in ${proseLang}.
- NEVER emit emoji, decorative symbols (🚀 ✅ etc.), or assessment-platform UI chrome ("Tempo restante", "Clique em Next question", "Boa sorte", "Question 3/20", progress bars). Those are not part of a solution and expose the tool when auto-typed.
- NEVER print verification claims like "✓ Matches expected output" or "Output: correct" unless you have ACTUALLY traced it step by step in the Sanity check below. Do not fabricate green checks.
- If the input is blank or you don't have the actual problem yet, reply with ONE short line asking for the problem — do NOT emit a template with placeholders or emoji.

For every request, structure your reply in EXACTLY this format (use markdown headings):

## Approach — the "why" behind the choice
2-4 sentences: the strategy, its time and space complexity, and explicitly WHY this approach over the main alternative — the concrete trade-off being made. This is the justification the candidate needs to be able to articulate if asked to defend the choice, so make it specific and grounded in this problem, not generic.

## Solution
A single fenced code block in the language explicitly requested by the interviewer or already used in the supplied problem/solution. When no language is specified, choose from the ACTIVE TARGET ROLE below, not from the candidate's historical primary stack. For a Python or TypeScript/Node.js role, prefer Python unless the problem or interviewer indicates TypeScript/JavaScript. If there is no role context or it does not identify a suitable language, briefly ask which language to use. Production-quality code, not toy code. Comments only where they clarify intent.

## Sanity check (MANDATORY — do NOT skip)
Before finishing, mentally execute the code against ONE concrete sample. Show:
- Input: [specific values]
- Trace: [walk through the key steps, especially loops, comparators, recursion bases, edge conditions]
- Output: [expected]

While tracing, verify these common bug classes — if you find any, FIX the Solution above and re-trace:
1. Comparator return values (returning a bool instead of int, wrong sign for ascending/descending, equality not returning 0).
2. Off-by-one errors in loop bounds (< vs <=, length vs length-1).
3. Edge cases: empty input, single element, duplicates, negative numbers, integer overflow on sums/products.
4. Reference vs value semantics (mutating a list while iterating, shared references in dicts).
5. Async correctness (missing await, not capturing closure variables).

## How to explain it out loud
3-5 short bullets the candidate can verbalize while typing. First person ("I'd start by..." / "The key insight is..." / "I'm sorting by X so that..."). No meta references to AI. Include the sample trace from the Sanity check so the candidate can naturally narrate it.

For follow-up turns, you may skip "Approach" but ALWAYS include "Sanity check" — that is the most common reason candidates lose points.`;

  const profileBlock = [
    `=== ACTIVE TARGET ROLE (takes precedence over CV when choosing an unspecified code language) ===\n${s.jobDescription.trim() || '[No target role configured — ask which code language to use]'}`,
    `=== CONFIRMED SCREENING FACTS (respect experience limits) ===\n${screeningFacts(s)}`,
    resume ? `=== CANDIDATE PROFILE (historical experience, not the target role stack) ===\n${resume}` : '',
  ].filter(Boolean).join('\n\n');

  // Referenced solution (same bundle the interview prompt sees). Enables
  // "the interviewer asked me to change X in my dashboard" turns to produce a
  // concrete proposal against the real files instead of generic code.
  const solutionBundle = getSolutionBundle();
  const solutionBlock = solutionBundle
    ? `=== REFERENCED SOLUTION (code the candidate already submitted to this company) ===
These are the REAL files of the solution the candidate already sent, read from their machine. When the request is about changing, extending, fixing, or explaining THIS solution (e.g. "the interviewer asked me to add a filter to my dashboard"), work on THIS code — not a from-scratch rewrite:
- State the exact file (and function/section) where each change goes, using the real names below.
- In "## Solution", show the modified section in full, ready to paste — not the entire file unless it is small. For multiple spots, one fenced block per file, each preceded by the file name.
- Match the existing code style, naming, formatting, and libraries. Introduce NO new dependency, framework, or build step unless explicitly requested.
- Preserve current behavior everything else depends on; call out anything the change might break.
- Keep the mandatory "Sanity check" and "How to explain it out loud" sections — the explanation bullets should sound like the candidate knows their own code ("in my index.html I already do X, so I'd hook the filter there...").
- If the request is NOT about this solution, ignore this section and solve the problem normally.

${solutionBundle}
=== END REFERENCED SOLUTION ===`
    : '';

  // Same cache-driven order as the interview prompt: stable cached blocks
  // first (1h TTL), volatile instructions (interview-language interpolation)
  // last, so a live language switch doesn't re-ingest the solution bundle.
  return [
    ...(profileBlock
      ? ([
          {
            type: 'text',
            text: profileBlock,
            cache_control: { type: 'ephemeral', ttl: '1h' },
          },
        ] as Anthropic.Messages.TextBlockParam[])
      : []),
    ...(solutionBlock
      ? ([
          {
            type: 'text',
            text: solutionBlock,
            cache_control: { type: 'ephemeral', ttl: '1h' },
          },
        ] as Anthropic.Messages.TextBlockParam[])
      : []),
    { type: 'text', text: instructions },
  ];
}

export async function startCoding(
  history: CodingMessage[],
  win: BrowserWindow
): Promise<void> {
  const key = getAnthropicKey();
  if (!key) {
    win.webContents.send(IPC.CODE_ERROR, 'Anthropic API key not configured');
    return;
  }
  if (history.length === 0 || history[history.length - 1].role !== 'user') {
    win.webContents.send(IPC.CODE_ERROR, 'Last message must be from user');
    return;
  }

  if (inFlightCoding) inFlightCoding.abort();
  inFlightCoding = new AbortController();

  const settings = getSettings();
  const client = new Anthropic({ apiKey: key });

  let buffer = '';

  try {
    const stream = client.messages.stream(
      {
        model: settings.model,
        // Multi-file change proposals against a referenced solution routinely
        // exceed the old 2000 cap; streaming is used, so a high cap is safe.
        max_tokens: 8000,
        system: buildCodingSystemBlocks(),
        messages: history.map((m) => ({
          role: m.role,
          content:
            typeof m.content === 'string'
              ? m.content
              : (m.content.map((p) =>
                  p.type === 'text'
                    ? { type: 'text' as const, text: p.text }
                    : {
                        type: 'image' as const,
                        source: {
                          type: 'base64' as const,
                          media_type: p.mediaType as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
                          data: p.data,
                        },
                      }
                ) as Anthropic.Messages.ContentBlockParam[]),
        })),
      },
      { signal: inFlightCoding.signal }
    );

    stream.on('text', (delta) => {
      buffer += delta;
      if (!win.isDestroyed()) win.webContents.send(IPC.CODE_TOKEN, buffer);
    });

    const finalMsg = await stream.finalMessage();
    if (finalMsg.stop_reason === 'max_tokens') {
      // The output was cut off mid-answer. Make that visible both to the
      // candidate (who might otherwise paste incomplete code live) and to the
      // interview assistant, which receives this text as the on-screen
      // solution context.
      buffer +=
        '\n\n[Output truncated by the token limit — send "continue" to get the rest]';
      if (!win.isDestroyed()) win.webContents.send(IPC.CODE_TOKEN, buffer);
    }
    const lastMsg = history[history.length - 1];
    const userText =
      typeof lastMsg.content === 'string'
        ? lastMsg.content
        : lastMsg.content
            .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
            .map((p) => p.text)
            .join(' ');
    const hadImage =
      typeof lastMsg.content !== 'string' && lastMsg.content.some((p) => p.type === 'image');
    // Auto-capture this solution so the interview-answer assistant can speak
    // coherently about the code now on screen (see buildSystemBlocks).
    lastCodingSolution = buffer.trim();
    logCoding({ model: settings.model, userText, hadImage, response: buffer });
    if (!win.isDestroyed()) win.webContents.send(IPC.CODE_DONE, buffer);
  } catch (err) {
    if ((err as Error).name === 'AbortError') return;
    const msg = err instanceof Error ? err.message : String(err);
    if (!win.isDestroyed()) win.webContents.send(IPC.CODE_ERROR, msg);
  } finally {
    inFlightCoding = null;
  }
}

let inFlightTrans: AbortController | null = null;

export async function startTranslation(transcript: string, win: BrowserWindow): Promise<void> {
  const key = getAnthropicKey();
  if (!key) {
    win.webContents.send(IPC.ASSIST_ERROR, 'Anthropic API key not configured');
    return;
  }
  if (!transcript.trim()) return;

  if (inFlightTrans) inFlightTrans.abort();
  inFlightTrans = new AbortController();

  const settings = getSettings();
  const client = new Anthropic({ apiKey: key });

  let buffer = '';

  try {
    const stream = client.messages.stream(
      {
        model: settings.model,
        max_tokens: 300,
        system: `You are a translator. Translate the ${LANGUAGE_NAMES[settings.interviewLanguage]} text the user gives you into Brazilian Portuguese. Output ONLY the translation, no preamble, no commentary, no quotes. Keep it concise and natural. If the text is already in Brazilian Portuguese, return it unchanged.`,
        messages: [{ role: 'user', content: transcript }],
      },
      { signal: inFlightTrans.signal }
    );

    stream.on('text', (delta) => {
      buffer += delta;
      if (!win.isDestroyed()) win.webContents.send(IPC.TRANSLATE_TOKEN, buffer);
    });

    await stream.finalMessage();
    logInterview({
      mode: 'listen',
      model: settings.model,
      transcript,
      translation: buffer.trim(),
      response: '',
      latencyMs: 0,
    });
    if (!win.isDestroyed()) win.webContents.send(IPC.TRANSLATE_DONE, buffer.trim());
  } catch (err) {
    if ((err as Error).name === 'AbortError') return;
    const msg = err instanceof Error ? err.message : String(err);
    if (!win.isDestroyed()) win.webContents.send(IPC.ASSIST_ERROR, msg);
  } finally {
    inFlightTrans = null;
  }
}

// One-shot translation of a single transcript line, used by the live-transcript
// (Listen) mode. Independent per call — does NOT abort other in-flight calls,
// so a fast scrolling transcript can translate each line concurrently.
export async function translateLine(text: string): Promise<string> {
  const key = getAnthropicKey();
  if (!key) return '';
  if (!text.trim()) return '';
  const settings = getSettings();
  const client = new Anthropic({ apiKey: key });
  try {
    const res = await client.messages.create({
      model: settings.model,
      max_tokens: 400,
      system: `You are a translator. Translate the ${LANGUAGE_NAMES[settings.interviewLanguage]} text into Brazilian Portuguese. Output ONLY the translation — no preamble, no commentary, no quotes. Keep it natural. If the text is already Brazilian Portuguese, return it unchanged.`,
      messages: [{ role: 'user', content: text }],
    });
    const block = res.content.find((b) => b.type === 'text');
    return block && block.type === 'text' ? block.text.trim() : '';
  } catch {
    return '';
  }
}
