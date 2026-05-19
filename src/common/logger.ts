// Tiny leveled logger shared by main and renderer.
//
// Default level: `info` (prod) / `debug` (dev). Override with the
// AGENT_PULSE_LOG_LEVEL env var: debug | info | warn | error.
//
// The console sink is always installed. The main process additionally installs
// a daily-rotating file sink (see src/main/file-log-sink.ts).

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export type Sink = (level: LogLevel, args: unknown[]) => void;

const consoleSink: Sink = (level, args) => {
  const fn =
    level === 'warn' ? console.warn :
    level === 'error' ? console.error :
    console.log;
  fn(...(args as unknown[] as []));
};

function envLookup(name: string): string | undefined {
  try {
    if (typeof process !== 'undefined' && process.env && typeof process.env[name] === 'string') {
      return process.env[name];
    }
  } catch { /* renderer may shim process oddly */ }
  return undefined;
}

function isLogLevel(value: string | undefined): value is LogLevel {
  return value === 'debug' || value === 'info' || value === 'warn' || value === 'error';
}

function defaultLevel(): LogLevel {
  const override = envLookup('AGENT_PULSE_LOG_LEVEL')?.toLowerCase();
  if (isLogLevel(override)) return override;
  const nodeEnv = envLookup('NODE_ENV');
  return nodeEnv === 'production' ? 'info' : 'debug';
}

class Logger {
  private level: LogLevel = defaultLevel();
  private sinks: Sink[] = [consoleSink];

  setLevel(level: LogLevel) { this.level = level; }
  getLevel(): LogLevel { return this.level; }
  addSink(sink: Sink) { this.sinks.push(sink); }

  private emit(level: LogLevel, args: unknown[]) {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.level]) return;
    for (const sink of this.sinks) {
      try { sink(level, args); } catch { /* never let logging break the app */ }
    }
  }

  debug(...args: unknown[]) { this.emit('debug', args); }
  info(...args: unknown[])  { this.emit('info', args); }
  warn(...args: unknown[])  { this.emit('warn', args); }
  error(...args: unknown[]) { this.emit('error', args); }
}

export const logger = new Logger();
