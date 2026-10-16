import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { SolutionInfo } from '../shared/types';
import { getSettings, saveSettings } from './store';

// Referenced solution — a file or folder on disk that the candidate already
// submitted to the company (e.g. a take-home challenge). Loaded into a text
// bundle that both the interview-answer prompt and the coding prompt include
// (prompt-cached), so the assistants can answer questions about the REAL code
// and propose changes against it. Only metadata (SolutionInfo) crosses IPC;
// the bundle itself never leaves the main process.
//
// State semantics:
// - successful load → bundle + info set, path persisted.
// - failed load with NO prior success → info carries the error (fileCount 0),
//   bundle empty. The bad path is NOT persisted.
// - failed load AFTER a prior success (e.g. reload of a moved folder) → the
//   previous bundle stays active for the prompts, and info keeps the previous
//   name/fileCount with `error` set, so every window can show "reload failed,
//   still using the previous load" instead of silently diverging.

const TEXT_EXTS = new Set([
  '.html', '.htm', '.css', '.scss', '.less',
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx',
  '.json', '.md', '.txt',
  '.py', '.cs', '.csproj', '.sln', '.razor', '.cshtml',
  '.sql', '.vue', '.svelte', '.yml', '.yaml', '.xml', '.config',
  '.java', '.go', '.rb', '.php', '.sh', '.ps1',
]);

const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', 'out', 'bin', 'obj', 'coverage',
  'vendor', '__pycache__', 'testresults', 'packages',
]);

const SKIP_FILES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'composer.lock',
]);

const PER_FILE_CHAR_CAP = 48_000;
// Never read more than this many bytes of a single file — big data fixtures
// (.json/.sql dumps) must not be fully decoded just to keep the first 48k chars.
const READ_BYTE_CAP = PER_FILE_CHAR_CAP * 4;
const TOTAL_CHAR_CAP = 180_000;
const MAX_FILES = 60;
const MAX_SCAN = 400;
const MAX_DEPTH = 8;

let bundle = '';
let info: SolutionInfo | null = null;

export function getSolutionBundle(): string {
  return bundle;
}

export function getSolutionInfo(): SolutionInfo | null {
  return info;
}

export function clearSolution() {
  bundle = '';
  info = null;
  saveSettings({ solutionPath: '' });
}

// Load the persisted path on app start (if any). Never throws; on failure the
// error lands in getSolutionInfo() so the windows can surface it.
export async function initSolutionFromStore(): Promise<void> {
  const p = getSettings().solutionPath.trim();
  if (!p) return;
  try {
    await loadSolution(p);
  } catch (err) {
    console.error('[solution] failed to load persisted path:', err);
  }
}

// Reload from the persisted path (user edited files on disk). Returns null if
// no path is configured.
export async function reloadSolution(): Promise<SolutionInfo | null> {
  const p = getSettings().solutionPath.trim();
  if (!p) return null;
  return loadSolution(p);
}

function isTextFile(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower.startsWith('.')) return false; // dotfiles: low value, may hold secrets (.env)
  if (SKIP_FILES.has(lower)) return false;
  if (lower.endsWith('.min.js') || lower.endsWith('.min.css')) return false;
  return TEXT_EXTS.has(path.extname(lower));
}

// Entry files and docs first, so the size budget spends itself on what matters.
function fileScore(rel: string): number {
  const base = path.basename(rel).toLowerCase();
  if (base.startsWith('readme')) return 0;
  if (/^(index|main|app|program)\./.test(base)) return 1;
  return 2;
}

// Walks the tree following junctions/symlinks (with a realpath visited-set so
// link cycles terminate). Unreadable entries count as skipped, not silence.
async function collectFiles(root: string): Promise<{ files: string[]; skipped: number }> {
  const found: string[] = [];
  let skipped = 0;
  const visited = new Set<string>();
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH || found.length >= MAX_SCAN) return;
    let real: string;
    try {
      real = await fsp.realpath(dir);
    } catch {
      skipped++;
      return;
    }
    if (visited.has(real)) return;
    visited.add(real);
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      skipped++;
      return;
    }
    for (const e of entries) {
      if (found.length >= MAX_SCAN) return;
      const full = path.join(dir, e.name);
      let isDir = e.isDirectory();
      let isFile = e.isFile();
      if (e.isSymbolicLink()) {
        // Windows junctions and symlinks report neither dir nor file on the
        // Dirent — resolve through the link before deciding.
        try {
          const st = await fsp.stat(full);
          isDir = st.isDirectory();
          isFile = st.isFile();
        } catch {
          skipped++;
          continue;
        }
      }
      if (isDir) {
        const n = e.name.toLowerCase();
        if (n.startsWith('.') || SKIP_DIRS.has(n)) continue;
        await walk(full, depth + 1);
      } else if (isFile && isTextFile(e.name)) {
        found.push(full);
      }
    }
  };
  await walk(root, 0);
  return { files: found, skipped };
}

// Reads at most READ_BYTE_CAP bytes — a multi-hundred-MB fixture is never
// decoded whole just to keep its head.
async function readCapped(abs: string, size: number): Promise<{ content: string; clipped: boolean }> {
  if (size <= READ_BYTE_CAP) {
    return { content: await fsp.readFile(abs, 'utf8'), clipped: false };
  }
  const fh = await fsp.open(abs, 'r');
  try {
    const buf = Buffer.alloc(READ_BYTE_CAP);
    const { bytesRead } = await fh.read(buf, 0, READ_BYTE_CAP, 0);
    return { content: buf.subarray(0, bytesRead).toString('utf8'), clipped: true };
  } finally {
    await fh.close();
  }
}

// Loads a file or folder into the in-memory bundle. On success persists the
// path. On failure the bad path is NOT persisted; see the state-semantics note
// at the top for what happens to the previous bundle/info.
export async function loadSolution(rawPath: string): Promise<SolutionInfo> {
  // Tolerate paths pasted via Windows "Copy as path" (wrapped in quotes), and
  // resolve to an absolute path so the persisted value survives CWD changes
  // between dev runs and the packaged app.
  const p = path.resolve(rawPath.trim().replace(/^"(.*)"$/, '$1'));
  const fail = (error: string): SolutionInfo => {
    const prev = info && !info.error ? info : null;
    info = prev
      ? { ...prev, error }
      : {
          path: p,
          name: path.basename(p),
          fileCount: 0,
          totalChars: 0,
          truncated: false,
          omittedFiles: 0,
          loadedAt: new Date().toISOString(),
          error,
        };
    return info;
  };

  let stat: fs.Stats;
  try {
    stat = await fsp.stat(p);
  } catch {
    return fail('Path not found or not accessible');
  }

  const isDir = stat.isDirectory();
  const root = isDir ? p : path.dirname(p);
  let files: string[];
  let scanSkipped = 0;
  if (isDir) {
    const collected = await collectFiles(p);
    files = collected.files;
    scanSkipped = collected.skipped;
    if (files.length === 0) {
      return fail('No readable source files found in this folder');
    }
  } else {
    if (!isTextFile(path.basename(p))) {
      return fail(`Unsupported file type: ${path.extname(p) || '(none)'}`);
    }
    files = [p];
  }

  const rels = files
    .map((f) => path.relative(root, f).split(path.sep).join('/'))
    .sort((a, b) => fileScore(a) - fileScore(b) || a.localeCompare(b));

  const name = isDir
    ? path.basename(p)
    : `${path.basename(root)}/${path.basename(p)}`;

  const included: { rel: string; content: string; bytes: number }[] = [];
  let total = 0;
  let truncated = false;
  let omitted = scanSkipped;
  for (const rel of rels) {
    if (included.length >= MAX_FILES || total >= TOTAL_CHAR_CAP) {
      omitted++;
      truncated = true;
      continue;
    }
    let content: string;
    let bytes: number;
    try {
      const abs = path.join(root, ...rel.split('/'));
      bytes = (await fsp.stat(abs)).size;
      const read = await readCapped(abs, bytes);
      content = read.content;
      if (read.clipped) truncated = true;
    } catch {
      omitted++;
      continue;
    }
    if (content.length > PER_FILE_CHAR_CAP) {
      content = content.slice(0, PER_FILE_CHAR_CAP) + '\n[... file truncated ...]';
      truncated = true;
    }
    if (total + content.length > TOTAL_CHAR_CAP) {
      content = content.slice(0, Math.max(0, TOTAL_CHAR_CAP - total)) + '\n[... file truncated ...]';
      truncated = true;
    }
    included.push({ rel, content, bytes });
    total += content.length;
  }

  const header = [
    `Solution name: ${name}`,
    `Root: ${isDir ? p : root}`,
    `Files included (${included.length}${omitted ? `, ${omitted} omitted` : ''}):`,
    ...included.map((f) => `- ${f.rel} (${(f.bytes / 1024).toFixed(1)} KB)`),
  ].join('\n');

  bundle =
    header +
    '\n\n' +
    included.map((f) => `=== FILE: ${f.rel} ===\n${f.content}`).join('\n\n');

  info = {
    path: p,
    name,
    fileCount: included.length,
    totalChars: total,
    truncated,
    omittedFiles: omitted,
    loadedAt: new Date().toISOString(),
  };
  saveSettings({ solutionPath: p });
  return info;
}
