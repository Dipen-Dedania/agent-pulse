// Daily-rotating file sink for the main process logger.
//
// Files live in Electron's `logs` directory (`app.getPath('logs')`):
//   Windows: %APPDATA%/<App>/logs
//   macOS:   ~/Library/Logs/<App>
//   Linux:   ~/.config/<App>/logs
//
// One file per day: agent-pulse-YYYY-MM-DD.log. Files older than RETENTION_DAYS
// are deleted on startup. The stream is opened lazily on the first write and
// rolled over automatically when the date changes mid-process.

import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { logger, LogLevel } from '../common/logger';

const RETENTION_DAYS = 7;

const LEVEL_LABEL: Record<LogLevel, string> = {
  debug: 'DEBUG',
  info:  'INFO ',
  warn:  'WARN ',
  error: 'ERROR',
};

let logDir: string | null = null;
let currentDate: string | null = null;
let currentStream: fs.WriteStream | null = null;

function todayString(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function pruneOldLogs(dir: string) {
  try {
    const files = fs.readdirSync(dir).filter(f => /^agent-pulse-\d{4}-\d{2}-\d{2}\.log$/.test(f));
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    for (const file of files) {
      const full = path.join(dir, file);
      try {
        if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full);
      } catch { /* best-effort */ }
    }
  } catch { /* best-effort */ }
}

function streamForToday(): fs.WriteStream | null {
  if (!logDir) return null;
  const date = todayString();
  if (currentDate === date && currentStream && !currentStream.destroyed) return currentStream;

  if (currentStream) {
    try { currentStream.end(); } catch { /* ignore */ }
  }
  const file = path.join(logDir, `agent-pulse-${date}.log`);
  currentStream = fs.createWriteStream(file, { flags: 'a' });
  currentDate = date;
  return currentStream;
}

function formatLine(level: LogLevel, args: unknown[]): string {
  const ts = new Date().toISOString();
  const body = args.map(arg => {
    if (typeof arg === 'string') return arg;
    if (arg instanceof Error) return `${arg.message}${arg.stack ? `\n${arg.stack}` : ''}`;
    try { return JSON.stringify(arg); } catch { return String(arg); }
  }).join(' ');
  return `${ts} ${LEVEL_LABEL[level]} ${body}\n`;
}

export function installFileLogSink() {
  try {
    logDir = app.getPath('logs');
    fs.mkdirSync(logDir, { recursive: true });
    pruneOldLogs(logDir);
  } catch (e) {
    // Console sink is still active — surface the failure but don't crash.
    console.warn('[file-log-sink] could not initialize log directory:', e);
    return;
  }

  logger.addSink((level, args) => {
    const stream = streamForToday();
    if (!stream) return;
    stream.write(formatLine(level, args));
  });

  app.on('will-quit', () => {
    if (currentStream) {
      try { currentStream.end(); } catch { /* ignore */ }
    }
  });
}
