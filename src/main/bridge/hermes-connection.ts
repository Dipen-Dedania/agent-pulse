import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

/** Hermes's default profile home: %LOCALAPPDATA%\hermes on native Windows, ~/.hermes elsewhere. */
export function hermesHome(): string {
  if (process.env.HERMES_HOME) return process.env.HERMES_HOME;
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) return path.join(process.env.LOCALAPPDATA, 'hermes');
  return path.join(os.homedir(), '.hermes');
}

// Write `data` to `file` inside ~/.agent-pulse via temp + rename, refusing
// symlinked targets. Returns false on any failure.
function writePrivate(dir: string, file: string, data: string | Buffer, mode: number): boolean {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(dir).isSymbolicLink()) return false;
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) return false;
  const temp = `${file}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  fs.writeFileSync(temp, data, { mode, flag: 'wx' });
  fs.renameSync(temp, file);
  return true;
}

/** Separate capability: Hermes cannot use the backlog/MCP token. Rotated on startup. */
export function writeHermesConnection(port: number): string | null {
  const dir = path.join(os.homedir(), '.agent-pulse');
  try {
    const token = crypto.randomBytes(32).toString('hex');
    return writePrivate(dir, path.join(dir, 'hermes.json'), JSON.stringify({ port, token }), 0o600) ? token : null;
  } catch { return null; }
}

/**
 * Copy the bundled setup helper to ~/.agent-pulse/hermes/agent_pulse.py so the
 * Settings guide can name one stable path on every platform (packaged installs
 * have no repo checkout, and the app directory changes on every update). Only
 * when a Hermes home exists; rewritten only when the bundled content changed.
 */
export function publishHermesHelper(source: string): string | null {
  const dir = path.join(os.homedir(), '.agent-pulse', 'hermes');
  const file = path.join(dir, 'agent_pulse.py');
  try {
    if (!fs.existsSync(hermesHome())) return null;
    const content = fs.readFileSync(source);
    if (fs.existsSync(file) && !fs.lstatSync(file).isSymbolicLink() && fs.readFileSync(file).equals(content)) return file;
    return writePrivate(dir, file, content, 0o600) ? file : null;
  } catch { return null; }
}
