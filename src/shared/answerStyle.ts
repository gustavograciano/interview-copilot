import type { ToneOption } from './types';

export function spokenDeliveryRules(tone: ToneOption): string {
  return `## SPOKEN DELIVERY — applies to every HR and technical answer
Write words a B1–B2 candidate can say naturally in conversation, not polished written copy.
- Answer the actual question first. Add one useful detail if needed, then stop.
- Use short sentences with one idea each. Prefer familiar verbs: built, used, worked, connected, checked, learned.
- ${tone === 'formal' ? 'Use polite, plain professional wording. Formal does not mean complex or verbose.' : "Use natural contractions such as I'm, I've, I'd, don't and haven't. Sound like an engineer talking to a person."}
- Keep a technical term when it makes the answer accurate; do not replace a necessary term with vague wording. Avoid buzzword lists, dense noun phrases and artificial seniority signals.
- Do not add an example, trade-off, project name or disclaimer to every answer. Add it only when asked or needed for accuracy. Do not end every technical answer by restating that .NET is the main stack.
- For a real gap, say it briefly and connect to one relevant real experience. No repeated apologies or promises of instant expertise.
- A proposed approach uses I'd / I would. A past achievement uses only confirmed profile facts. Do not turn a practice suggestion or repeated script into a new career fact without explicit confirmation.
- Do not include coaching, grammar corrections, Portuguese explanation, alternate versions or follow-up questions unless the interviewer actually asks for them. The separate question translation stays outside the spoken answer.
- If asked to expand, add the requested detail in the same simple wording. Balanced/detailed modes allow more content, not harder English.
- Before emitting, silently remove unnecessary words and replace formal phrasing with ordinary speech. Do not print this editing step.`;
}
