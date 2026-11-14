import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

/** Separate capability: Hermes cannot use the backlog/MCP token. Rotated on startup. */
export function writeHermesConnection(port: number): string | null {
  const dir = path.join(os.homedir(), '.agent-pulse');
  const file = path.join(dir, 'hermes.json');
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (fs.lstatSync(dir).isSymbolicLink()) return null;
    if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) return null;
    const token = crypto.randomBytes(32).toString('hex');
    const temp = `${file}.${crypto.randomBytes(8).toString('hex')}.tmp`;
    fs.writeFileSync(temp, JSON.stringify({ port, token }), { mode: 0o600, flag: 'wx' });
    fs.renameSync(temp, file);
    return token;
  } catch { return null; }
}
