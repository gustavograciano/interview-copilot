import { app, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

// Appends interaction records to a per-day JSONL file under userData/session-logs.
// JSONL = one JSON object per line — append-only, trivial to parse/analyze later.

function logDir(): string {
  const dir = path.join(app.getPath('userData'), 'session-logs');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function currentFile(): string {
  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return path.join(logDir(), `session-${day}.jsonl`);
}

function append(entry: Record<string, unknown>) {
  try {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
    fs.appendFileSync(currentFile(), line, 'utf8');
  } catch (err) {
    console.error('[sessionLog] failed to write', err);
  }
}

export interface InterviewLogEntry {
  mode: 'interview' | 'listen';
  model: string;
  transcript: string;
  translation: string;
  response: string;
  latencyMs: number;
}

export function logInterview(e: InterviewLogEntry) {
  append({ type: 'interview', ...e });
}

export interface CodingLogEntry {
  model: string;
  userText: string;
  hadImage: boolean;
  response: string;
}

export function logCoding(e: CodingLogEntry) {
  append({ type: 'coding', ...e });
}

export function getLogDir(): string {
  return logDir();
}

export function openLogDir(): Promise<string> {
  return shell.openPath(logDir());
}
