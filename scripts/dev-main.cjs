#!/usr/bin/env node
// Dev launcher for the main process: compile, then run Electron — with timing.
//
// In dev the wait between pressing Enter and the splash is dominated by what
// happens BEFORE Electron exists (npm wrappers, Vite, wait-on, a full tsc
// compile), none of which can appear in the app's own `[Boot]` log. This
// script stamps the moment the command started, times the compile, and hands
// the start stamp to Electron via AGENT_PULSE_LAUNCH_T0 so the main process
// can log how long after the command its own process was created.
//
// Replaces: npm run build:main && cross-env NODE_ENV=development electron …

const { spawnSync, spawn } = require('child_process');
const path = require('path');

const t0 = Date.now();
const root = path.resolve(__dirname, '..');
const stamp = () => `+${Date.now() - t0}ms`;
const log = (msg) => console.log(`[dev] ${msg} (${stamp()})`);

// Spawn the real binaries, not the node_modules/.bin cmd shims: going through
// cmd.exe on Windows makes Ctrl+C ask "Terminate batch job (Y/N)?" and adds a
// shell hop to the launch we are trying to measure.
const tscJs = require.resolve('typescript/bin/tsc', { paths: [root] });
const electronExe = require(require.resolve('electron', { paths: [root] })); // exports the binary path

log('dev:main started');

// Compile. tsconfig.main.json is incremental, so an unchanged tree is quick.
const tscStart = Date.now();
const tsc = spawnSync(process.execPath, [tscJs, '-p', 'tsconfig.main.json'], { cwd: root, stdio: 'inherit' });
log(`tsc finished in ${Date.now() - tscStart}ms, exit ${tsc.status}`);
if (tsc.status !== 0) process.exit(tsc.status ?? 1);

log('spawning electron');
const electron = spawn(electronExe, ['dist/main/index.js'], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'development',
    AGENT_PULSE_LAUNCH_T0: String(t0),
  },
});
electron.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});

// Forward termination to Electron. `concurrently` stops this launcher with
// SIGTERM on macOS/Linux (taskkill /T on Windows); without forwarding, the
// Electron grandchild would survive the launcher on POSIX. cross-env, which
// this script replaced, did the same.
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
  try {
    process.on(sig, () => {
      if (!electron.killed) electron.kill(sig === 'SIGBREAK' ? 'SIGTERM' : sig);
    });
  } catch {
    // SIGBREAK is Windows-only; other platforms throw on registering it.
  }
}
