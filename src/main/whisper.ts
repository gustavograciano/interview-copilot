import OpenAI from 'openai';
import { toFile } from 'openai/uploads';
import { getGroqKey, getSettings } from './store';

// Groq hosts whisper-large-v3-turbo — fast, free tier, OpenAI-compatible API.
const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
const STT_MODEL = 'whisper-large-v3-turbo';

export async function transcribe(audio: ArrayBuffer, mime: string): Promise<string> {
  const key = getGroqKey();
  if (!key) throw new Error('Groq API key not configured');

  const client = new OpenAI({ apiKey: key, baseURL: GROQ_BASE_URL });
  const ext = mime.includes('webm')
    ? 'webm'
    : mime.includes('wav')
      ? 'wav'
      : mime.includes('mp4')
        ? 'mp4'
        : 'ogg';
  const file = await toFile(Buffer.from(audio), `chunk.${ext}`, { type: mime });

  // No rolling context across chunks — each interview question is independent and
  // Whisper hallucinates badly when the prompt echoes prior audio.
  //
  // CRITICAL: a LONG vocabulary-hint prompt makes Whisper hallucinate those exact
  // terms into background noise/echo/silence (e.g. ".NET .NET .NET, GCP, S3...").
  // We therefore cap the hint to a small number of terms. Fewer, high-value proper
  // nouns help spelling without poisoning noisy audio.
  const MAX_HINT_TERMS = 8;
  const rawHints = getSettings().vocabularyHints.trim();
  const hints = rawHints
    ? rawHints
        .split(/[,\n]/)
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, MAX_HINT_TERMS)
        .join(', ')
    : '';
  const prompt = hints || undefined;

  // Auto-detect the spoken language (no `language` hint). The interviewer may
  // speak a different language than the one the candidate answers in — e.g. an
  // English question while answering in PT, or a Portuguese interpreter — so
  // forcing a language here would garble cross-language audio. The ANSWER
  // language is handled separately in claude.ts via interviewLanguage.
  const res = await client.audio.transcriptions.create({
    model: STT_MODEL,
    file,
    prompt,
    temperature: 0,
  });

  return (res.text ?? '').trim();
}
