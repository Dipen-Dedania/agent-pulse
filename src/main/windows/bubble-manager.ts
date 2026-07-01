import { BrowserWindow, ipcMain, screen, app, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import open, { openApp } from 'open';
import { ToolId, ToolStatus, BubbleConfig, BubbleSize, BubbleStackPosition, BubbleAnchor, BubbleDisplayMatch } from '../../common/types';
import { logger } from '../../common/logger';

// Pixel footprint of the bubble window per size. Width hugs the orb; height is
// taller so Claude's usage bars render in the bottom strip without a per-tool
// resize. `tooltip` is the extra height the hover tooltip would claim (the
// tooltip is currently disabled, but the value is kept consistent per size).
const BUBBLE_DIMENSIONS: Record<BubbleSize, { width: number; height: number; tooltip: number }> = {
  small:  { width: 58, height: 76,  tooltip: 90 },
  medium: { width: 70, height: 90,  tooltip: 110 },
  large:  { width: 86, height: 110, tooltip: 132 },
};

// Footprint for the Claude bubble when the Clawd mascot is on. Width MATCHES the
// orb window (BUBBLE_DIMENSIONS) so that — with the stack right-edge aligned —
// every bubble shares a vertical centerline; the narrower mascot SVG is centered
// within (see MASCOT_WIDTH in Bubble.tsx, which stays ≤ these widths so no prop
// clips). Height adds the usage-bar strip + bottom breathing room beneath the
// mascot. Only the Claude bubble uses these.
const MASCOT_DIMENSIONS: Record<BubbleSize, { width: number; height: number }> = {
  small:  { width: 58, height: 81 },
  medium: { width: 70, height: 94 },
  large:  { width: 86, height: 112 },
};

// Footprint for the Codex bubble when the frog mascot is on. Width MATCHES the
// orb window (BUBBLE_DIMENSIONS) so every bubble shares a vertical centerline
// under the right-edge-aligned stack; the narrower frog SVG is centered within
// (see MASCOT_WIDTH_CODEX in Bubble.tsx, ≤ these widths). The frog is taller than
// Clawd (more headroom for the held sign + splayed hind legs), so it gets a bit
// more vertical room; height adds the usage-bar strip + bottom breathing room.
// Only the Codex bubble uses these.
const MASCOT_DIMENSIONS_CODEX: Record<BubbleSize, { width: number; height: number }> = {
  small:  { width: 58, height: 74 },
  medium: { width: 70, height: 90 },
  large:  { width: 86, height: 104 },
};

// Footprint for the Antigravity bubble when the GIGI droplet mascot is on. Width
// MATCHES the orb window (BUBBLE_DIMENSIONS) so every bubble shares a vertical
// centerline under the right-edge-aligned stack; the narrower droplet SVG is
// centered within (see MASCOT_WIDTH_ANTIGRAVITY in Bubble.tsx, ≤ these widths).
// GIGI is a tall teardrop, so it gets more vertical room; height adds the
// usage-bar strip + bottom breathing room. Only the Antigravity bubble uses these.
const MASCOT_DIMENSIONS_ANTIGRAVITY: Record<BubbleSize, { width: number; height: number }> = {
  small:  { width: 58, height: 80 },
  medium: { width: 70, height: 97 },
  large:  { width: 86, height: 114 },
};

// ─── macOS / Linux ────────────────────────────────────────────────────────────
// macOS: `open -a <name>` activates the existing window (or launches if not running)
// Linux: binary name executed directly
// null: no app to launch by name. claude-code is terminal-only — launching a
// bare terminal lands the user in an EMPTY shell, not their session (the
// PID-chain walk in focusTool finds the real hosting app instead). The codex
// CLI on Linux is headless, so launching it by name would just spawn a stray
// background process.
const TOOL_APP_NAME: Record<ToolId, { mac: string | null; linux: string | null }> = {
  'cursor':         { mac: 'Cursor',             linux: 'cursor' },
  'vscode-copilot': { mac: 'Visual Studio Code', linux: 'code' },
  'claude-code':    { mac: null,                  linux: null },
  // Codex desktop app — activate/launch that, never a bare terminal.
  'openai-codex':   { mac: 'Codex',               linux: null },
  // agy ships with the Antigravity IDE — activate/launch that, not a bare terminal.
  'antigravity-cli':{ mac: 'Antigravity',         linux: 'antigravity' },
  'kiro':           { mac: 'Kiro',                linux: 'kiro' },
};

// Last-resort click target: the tool's product page. Used only after every
// focus/launch route failed (no live session, app not installed) — better to
// land the user somewhere meaningful than to do nothing or open an empty
// terminal.
const TOOL_WEB_URLS: Record<ToolId, string> = {
  'claude-code':     'https://claude.ai',
  'cursor':          'https://cursor.com',
  'vscode-copilot':  'https://code.visualstudio.com',
  'openai-codex':    'https://openai.com/codex',
  'kiro':            'https://kiro.dev',
  'antigravity-cli': 'https://antigravity.google',
};

// ─── Windows ─────────────────────────────────────────────────────────────────
// GUI editors own their windows, so a direct window-owner search by process
// name works. EnumWindows returns windows front→back (Z-order), so the first
// match is the most-recently-active window — correct with multiple instances.
const TOOL_WIN_WINDOW_PROCESS_NAMES: Partial<Record<ToolId, string[]>> = {
  'cursor':         ['Cursor'],
  'vscode-copilot': ['Code'],
  'kiro':           ['Kiro'],
  // The agy CLI ships with the Antigravity IDE — when no CLI session is
  // found, a running IDE window is the next-best focus target.
  'antigravity-cli': ['Antigravity'],
  // Codex desktop app (MSIX-packaged Electron, process name `Codex`).
  'openai-codex':    ['Codex'],
};

// CLI agents never own a window — their terminal HOST does. To focus them
// without a hook-captured PID, find the live CLI process by name and walk its
// parent chain to the window (focusWindowByPid on Windows,
// focusMacAppByPidChain on macOS). Generic terminal-host names
// (WindowsTerminal, pwsh, Terminal, …) must NOT be searched directly: that
// foregrounds whichever terminal is topmost, usually another tool's session.
// Names are the bare executable name (no extension) on both platforms; the
// exact-match lookups keep e.g. the Claude desktop app ("Claude") out.
const TOOL_CLI_PROCESS_NAMES: Partial<Record<ToolId, string[]>> = {
  'claude-code':    ['claude'],
  'openai-codex':   ['codex'],
  'antigravity-cli':['agy'],
};

// URI schemes registered by GUI editors (HKCR on Windows, LaunchServices on
// macOS, x-scheme-handler on Linux). Used only to RESOLVE/launch the app when
// it is not running — never to focus an already-open window (a scheme can't
// target a window, and `<scheme>://file/...` deeplinks would overwrite the
// user's open folder; see bubble-click-research.md). claude-code has no entry
// on purpose: it's terminal-only, nothing to launch.
const TOOL_URI_SCHEMES: Partial<Record<ToolId, string>> = {
  'cursor':          'cursor',
  'vscode-copilot':  'vscode',
  'kiro':            'kiro',        // unverified (Kiro registers no scheme on this machine); harmless if absent
  'antigravity-cli': 'antigravity', // the agy CLI ships with the Antigravity IDE — launch that
  'openai-codex':    'codex',       // Codex desktop app is MSIX-packaged: protocol activation only, no shell\open\command
};

const execFileAsync = promisify(execFile);

// Last-resort launch paths for GUI tools, used only when the URI-scheme
// registration (resolveWindowsExeFromScheme) yields nothing.
const TOOL_WIN_EXE_CANDIDATES: Partial<Record<ToolId, string[]>> = {
  'cursor': [
    '%LOCALAPPDATA%\\Programs\\cursor\\Cursor.exe',
    'C:\\Program Files\\Cursor\\Cursor.exe',
  ],
  'vscode-copilot': [
    '%LOCALAPPDATA%\\Programs\\Microsoft VS Code\\Code.exe',
    'C:\\Program Files\\Microsoft VS Code\\Code.exe',
  ],
  'kiro': [
    '%LOCALAPPDATA%\\Programs\\kiro\\Kiro.exe',
    'C:\\Program Files\\Kiro\\Kiro.exe',
  ],
};

/**
 * Resolve a tool's exe from its URI-scheme registration:
 * `HKCR\<scheme>\shell\open\command` → `"C:\...\Cursor.exe" --open-url -- "%1"`.
 * The OS keeps this current across installs/moves, so it beats any hard-coded
 * path list. We extract the exe and launch it plainly rather than opening the
 * bare scheme URL — per-fork handling of an empty deeplink is undefined.
 */
async function resolveWindowsExeFromScheme(toolId: ToolId): Promise<string | null> {
  const scheme = TOOL_URI_SCHEMES[toolId];
  if (!scheme) return null;
  try {
    const { stdout } = await execFileAsync('reg', [
      'query', `HKCR\\${scheme}\\shell\\open\\command`, '/ve',
    ]);
    const valueMatch = stdout.match(/REG_SZ\s+(.+)/);
    if (!valueMatch) return null;
    const command = valueMatch[1].trim();
    const exe = command.match(/^"([^"]+)"/)?.[1] ?? command.match(/^(\S+?\.exe)/i)?.[1];
    if (exe && fs.existsSync(exe)) return exe;
    logger.debug(`[BubbleManager] ${scheme}:// command exe not on disk: ${exe ?? command}`);
    return null;
  } catch {
    // reg.exe exits non-zero when the key doesn't exist — scheme not registered.
    logger.debug(`[BubbleManager] no ${scheme}:// registration in HKCR`);
    return null;
  }
}

function resolveWindowsExe(toolId: ToolId): string | null {
  const candidates = TOOL_WIN_EXE_CANDIDATES[toolId];
  if (!candidates) return null;
  const localAppData = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
  for (const candidate of candidates) {
    const resolved = candidate.replace('%LOCALAPPDATA%', localAppData);
    if (fs.existsSync(resolved)) return resolved;
  }
  return null;
}

// True when the scheme is registered at all (the `URL Protocol` marker on the
// HKCR key). MSIX-packaged apps (e.g. the Codex desktop app) register exactly
// this stub — protocol activation is routed by the OS with no
// shell\open\command — so an exe can't be resolved but opening the URL works.
// Gating on this marker also keeps shell.openExternal from popping the
// "find an app in the Store" dialog for unregistered schemes.
async function windowsSchemeIsRegistered(scheme: string): Promise<boolean> {
  try {
    await execFileAsync('reg', ['query', `HKCR\\${scheme}`, '/v', 'URL Protocol']);
    return true;
  } catch {
    return false;
  }
}

// PIDs of all live CLI processes matching any of `names` (exe name without
// extension). Feeds focusWindowByPid for CLI tools whose hook PID is unknown.
// Processes installed under WindowsApps are excluded: those are MSIX GUI apps
// that can share a CLI's name (the Codex desktop app's processes are
// `Codex.exe`), and walking a GUI process's ancestors escapes the app into
// whatever launched it (e.g. the browser that handled its URI scheme).
async function getWindowsPidsByName(names: string[]): Promise<number[]> {
  const parsePids = (stdout: string): number[] => stdout
    .split(/\r?\n/)
    .map((line) => parseInt(line.trim(), 10))
    .filter((pid) => Number.isFinite(pid) && pid > 0);
  try {
    const nameList = names.map((n) => `'${n}'`).join(',');
    // `exit 0`: Get-Process records a non-terminating error for each name with
    // no matching process (even under SilentlyContinue), which makes
    // powershell.exe exit 1 although matches for OTHER names were printed fine.
    const { stdout } = await execFileAsync('powershell', [
      '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command',
      `Get-Process -Name ${nameList} -ErrorAction SilentlyContinue | Where-Object { $_.Path -notlike '*\\WindowsApps\\*' } | ForEach-Object { $_.Id }; exit 0`,
    ]);
    return parsePids(stdout);
  } catch (err: any) {
    // Belt-and-braces: salvage whatever was printed before a non-zero exit.
    return typeof err?.stdout === 'string' ? parsePids(err.stdout) : [];
  }
}

/**
 * Find a window belonging to any of `processNames` and force it to the
 * foreground. Single PowerShell call, single Add-Type compilation.
 *
 * Why this is non-trivial on modern Windows:
 *
 * 1. Z-order: For tools with multiple windows (e.g. several Cursor instances),
 *    we want the most-recently-active one. EnumWindows walks top-level windows
 *    strictly front→back, so the first visible match is the right one.
 *
 * 2. Process discovery: Process.GetProcessesByName() (NOT MainModule.FileName)
 *    avoids permission errors on protected child processes that some Electron
 *    apps spawn — those silently fail MainModule reads and would be skipped.
 *
 * 3. Foreground-lock policy: When called from a non-foreground process,
 *    SetForegroundWindow silently no-ops (returns true but does nothing).
 *    The standard mitigation is to briefly attach our thread input to the
 *    target's thread input, which lifts the lock for one SetForegroundWindow
 *    call. We then detach.
 *
 * 4. Minimised windows: ShowWindow with SW_RESTORE (9) un-minimises before
 *    we try to bring it forward.
 */
function focusWindowsByProcessNames(processNames: string[]): Promise<boolean> {
  const nameList = processNames.map(n => `'${n}'`).join(', ');

  const script = `
$names = @(${nameList})
try {
  Add-Type -ErrorAction Stop -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
public class APFocus {
  public delegate bool WNDENUMPROC(IntPtr h, IntPtr lp);
  [DllImport("user32.dll")] public static extern bool EnumWindows(WNDENUMPROC cb, IntPtr lp);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();

  public static IntPtr FindTopmost(string[] names) {
    var pids = new List<int>();
    foreach (var name in names) {
      foreach (var p in Process.GetProcessesByName(name)) {
        pids.Add(p.Id);
      }
    }
    if (pids.Count == 0) return IntPtr.Zero;
    IntPtr found = IntPtr.Zero;
    var cb = new WNDENUMPROC((h, lp) => {
      if (!IsWindowVisible(h)) return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (pids.Contains((int)pid)) { found = h; return false; }
      return true;
    });
    EnumWindows(cb, IntPtr.Zero);
    GC.KeepAlive(cb);
    return found;
  }

  // Defeat foreground-lock by attaching our thread input to the foreground
  // thread for the duration of the SetForegroundWindow call.
  public static bool ForceForeground(IntPtr hwnd) {
    ShowWindow(hwnd, 9); // SW_RESTORE
    uint targetPid;
    uint targetThread = GetWindowThreadProcessId(hwnd, out targetPid);
    uint forePid;
    uint foreThread = GetWindowThreadProcessId(GetForegroundWindow(), out forePid);
    uint currentThread = GetCurrentThreadId();
    bool attachedToFore = false, attachedToTarget = false;
    try {
      if (foreThread != currentThread) attachedToFore = AttachThreadInput(currentThread, foreThread, true);
      if (targetThread != currentThread && targetThread != foreThread)
        attachedToTarget = AttachThreadInput(currentThread, targetThread, true);
      return SetForegroundWindow(hwnd);
    } finally {
      if (attachedToFore)   AttachThreadInput(currentThread, foreThread, false);
      if (attachedToTarget) AttachThreadInput(currentThread, targetThread, false);
    }
  }
}
"@
  $hwnd = [APFocus]::FindTopmost($names)
  if ($hwnd -eq [IntPtr]::Zero) { Write-Output "0:no_window"; exit }
  $ok = [APFocus]::ForceForeground($hwnd)
  # \${var}: PS braces required — bare $hwnd:ok would be parsed as a scoped
  # variable reference and the value would render empty.
  Write-Output "1:hwnd=\${hwnd}:ok=\${ok}"
} catch {
  Write-Output "0:err:$($_.ToString().Split([char]10)[0])"
}`.trim();

  const encoded = Buffer.from(script, 'utf16le').toString('base64');

  return new Promise<boolean>((resolve) => {
    execFile(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded],
      (err, stdout, stderr) => {
        const out = stdout.trim();
        if (err) {
          logger.warn('[BubbleManager] focus PS error:', stderr?.trim() || err.message);
          resolve(false);
          return;
        }
        const focused = out.startsWith('1:');
        logger.info(`[BubbleManager] focus result → ${out}`);
        resolve(focused);
      },
    );
  });
}

async function openToolWebPage(toolId: ToolId): Promise<void> {
  const url = TOOL_WEB_URLS[toolId];
  logger.info(`[BubbleManager] no app to focus/launch for ${toolId} — opening ${url}`);
  await shell.openExternal(url);
}

// Merge the hook-captured ancestor chain and the agent PID into one deduped
// candidate list. The chain includes short-lived shims (often dead by click
// time) plus the long-lived agent/terminal further up — try them all.
function collectPidCandidates(agentPid?: number, agentPidChain?: number[]): number[] {
  const candidates: number[] = [];
  if (Array.isArray(agentPidChain)) {
    for (const pid of agentPidChain) {
      if (typeof pid === 'number' && pid > 0 && !candidates.includes(pid)) {
        candidates.push(pid);
      }
    }
  }
  if (typeof agentPid === 'number' && agentPid > 0 && !candidates.includes(agentPid)) {
    candidates.push(agentPid);
  }
  return candidates;
}

// PIDs of live CLI processes matching any of `names`, by exact executable
// name (`pgrep -x`). Exact + case-sensitive on purpose: 'claude' must not
// match the Claude desktop app's 'Claude' processes — walking a GUI app's
// ancestors escapes into whatever launched it.
async function getMacPidsByName(names: string[]): Promise<number[]> {
  const pids: number[] = [];
  for (const name of names) {
    try {
      const { stdout } = await execFileAsync('pgrep', ['-x', name]);
      for (const line of stdout.split('\n')) {
        const pid = parseInt(line.trim(), 10);
        if (Number.isFinite(pid) && pid > 0 && !pids.includes(pid)) pids.push(pid);
      }
    } catch {
      // pgrep exits 1 when nothing matches — not an error.
    }
  }
  return pids;
}

/**
 * macOS: activate the .app actually hosting the agent by walking each start
 * PID's parent chain (`ps -o ppid=,comm=`; comm is the full executable path
 * on macOS). The nearest ancestor living inside a bundle — iTerm, Terminal,
 * VS Code, Cursor — is the session's host; `open <bundle>` activates that
 * running app without launching anything new and needs no Accessibility or
 * Automation permission. The non-greedy match takes the OUTERMOST .app, so
 * nested helper bundles (e.g. "Code Helper.app") resolve to the editor itself.
 */
async function focusMacAppByPidChain(startPids: number[]): Promise<boolean> {
  const seen = new Set<number>();
  for (const start of startPids) {
    let current = Math.floor(start);
    for (let depth = 0; depth < 15 && current > 1 && !seen.has(current); depth++) {
      seen.add(current);
      let ppid: number;
      let command: string;
      try {
        const { stdout } = await execFileAsync('ps', ['-o', 'ppid=,comm=', '-p', String(current)]);
        const match = stdout.trim().match(/^(\d+)\s+(.*)$/);
        if (!match) break;
        ppid = parseInt(match[1], 10);
        command = match[2];
      } catch {
        break; // PID already dead — try the next chain entry
      }
      const bundle = command.match(/^(.*?\.app)\//)?.[1];
      if (bundle) {
        try {
          await execFileAsync('open', [bundle]);
          logger.info(`[BubbleManager] focus-by-pid: activated ${bundle} (pid ${current})`);
          return true;
        } catch {
          logger.debug(`[BubbleManager] open ${bundle} failed; walking on`);
        }
      }
      current = ppid;
    }
  }
  return false;
}

async function focusTool(
  toolId: ToolId,
  agentPid?: number,
  agentPidChain?: number[],
): Promise<void> {
  const platform = process.platform;
  logger.debug(`[BubbleManager] focus-tool: toolId=${toolId} pid=${agentPid} chain=${JSON.stringify(agentPidChain)} platform=${platform}`);

  try {
    if (platform === 'win32') {
      // Try every hook-captured PID and walk parents from each — as long as
      // ONE PID is still alive, we'll reach a window-owning ancestor.
      const candidates = collectPidCandidates(agentPid, agentPidChain);

      let focused = false;
      if (candidates.length > 0) {
        focused = await focusWindowByPid(candidates);
      }

      // Fall back when no hook has fired yet (no PID known) or every PID in
      // the chain is dead. CLI session first: find the live CLI process by
      // name and reuse the parent walk to reach its hosting terminal's
      // window — never search terminal hosts directly (would foreground an
      // unrelated tool's terminal). Then GUI/IDE windows by owner process
      // name (for antigravity-cli that's the IDE the CLI ships with).
      const cliNames = TOOL_CLI_PROCESS_NAMES[toolId];
      if (!focused && cliNames) {
        const cliPids = await getWindowsPidsByName(cliNames);
        logger.debug(`[BubbleManager] cli process search ${JSON.stringify(cliNames)} → pids=${cliPids.join(',') || 'none'}`);
        if (cliPids.length > 0) {
          focused = await focusWindowByPid(cliPids);
        }
      }
      const windowNames = TOOL_WIN_WINDOW_PROCESS_NAMES[toolId];
      if (!focused && windowNames) {
        focused = await focusWindowsByProcessNames(windowNames);
      }

      if (!focused) {
        // Nothing matched — launch the GUI app if we can locate it. Prefer
        // the exe recorded in the URI-scheme registration (OS-maintained, no
        // path rot), then the hard-coded candidates, then protocol activation
        // for apps that registered the scheme without a command line (MSIX-
        // packaged apps like the Codex desktop app — opening the URL is their
        // only launch route). Last resort: the tool's web page — never a
        // stray empty terminal.
        const registryExe = await resolveWindowsExeFromScheme(toolId);
        const exePath = registryExe ?? resolveWindowsExe(toolId);
        const scheme = TOOL_URI_SCHEMES[toolId];
        if (exePath) {
          logger.info(`[BubbleManager] ${registryExe ? 'launch-registry' : 'launch-hardcoded'}: ${exePath}`);
          await open(exePath);
        } else if (scheme && await windowsSchemeIsRegistered(scheme)) {
          logger.info(`[BubbleManager] launch-scheme: ${scheme}://`);
          await shell.openExternal(`${scheme}://`);
        } else {
          await openToolWebPage(toolId);
        }
      }
    } else if (platform === 'darwin') {
      // Activate the app actually hosting the agent first — for CLI tools
      // that's the user's terminal or editor (iTerm, VS Code, Cursor), the
      // session they want back, not a fresh app instance.
      const candidates = collectPidCandidates(agentPid, agentPidChain);
      if (candidates.length > 0 && (await focusMacAppByPidChain(candidates))) {
        logger.debug(`[BubbleManager] focus-tool done for ${toolId}`);
        return;
      }

      // No hook-captured PID (session predates Agent Pulse, hooks not
      // installed) or every chain entry is dead — find the live CLI process
      // by name and walk to its host instead, mirroring the Windows fallback.
      const cliNames = TOOL_CLI_PROCESS_NAMES[toolId];
      if (cliNames) {
        const cliPids = await getMacPidsByName(cliNames);
        logger.debug(`[BubbleManager] cli process search ${JSON.stringify(cliNames)} → pids=${cliPids.join(',') || 'none'}`);
        if (cliPids.length > 0 && (await focusMacAppByPidChain(cliPids))) {
          logger.debug(`[BubbleManager] focus-tool done for ${toolId}`);
          return;
        }
      }

      const appName = TOOL_APP_NAME[toolId]?.mac;
      const scheme = TOOL_URI_SCHEMES[toolId];
      if (appName) {
        try {
          // `open -a` returns immediately: 0 once LaunchServices accepts the
          // activate/launch request, non-zero when no app matches the name.
          // (openApp() would swallow that failure.)
          await execFileAsync('open', ['-a', appName]);
          logger.debug(`[BubbleManager] launch-app: open -a "${appName}"`);
          return;
        } catch {
          logger.debug(`[BubbleManager] ${toolId}: app "${appName}" not found`);
        }
      }
      if (scheme) {
        try {
          // App-name route failed — let LaunchServices route by scheme instead.
          logger.info(`[BubbleManager] launch-scheme: open ${scheme}://`);
          await execFileAsync('open', [`${scheme}://`]);
          return;
        } catch {
          logger.debug(`[BubbleManager] ${toolId}: no handler for ${scheme}://`);
        }
      }
      // No live session, no installed app, no scheme handler → product page.
      await openToolWebPage(toolId);
    } else {
      const appName = TOOL_APP_NAME[toolId]?.linux;
      const scheme = TOOL_URI_SCHEMES[toolId];
      if (appName) {
        const onPath = await execFileAsync('which', [appName]).then(() => true, () => false);
        if (onPath) {
          // Electron editors are single-instance: this forwards to a running
          // instance or launches a fresh one.
          logger.debug(`[BubbleManager] launch-binary: ${appName}`);
          await openApp(appName);
          return;
        }
        logger.debug(`[BubbleManager] ${toolId}: "${appName}" not on PATH`);
      }
      if (scheme) {
        // Probe for a registered handler first — xdg-open on an unregistered
        // scheme fails silently or pops a chooser, neither of which we want.
        let handler = '';
        try {
          const { stdout } = await execFileAsync('xdg-mime', ['query', 'default', `x-scheme-handler/${scheme}`]);
          handler = stdout.trim();
        } catch { /* xdg-mime missing or errored — treat as no handler */ }
        if (handler) {
          logger.info(`[BubbleManager] launch-scheme: xdg-open ${scheme}:// (handler: ${handler})`);
          await execFileAsync('xdg-open', [`${scheme}://`]);
          return;
        }
      }
      // Not on PATH and no scheme handler → product page.
      await openToolWebPage(toolId);
    }
    logger.debug(`[BubbleManager] focus-tool done for ${toolId}`);
  } catch (err) {
    logger.warn(`[BubbleManager] focus-tool failed for ${toolId}:`, err);
  }
}

/**
 * PID-based focus: try each PID in `startPids`, walking up the parent chain
 * from each via Win32_Process.ParentProcessId. Returns true once any
 * ancestor owns a visible top-level window and is brought to the foreground.
 *
 * Why a list: hook scripts capture an ancestor chain (parent, grandparent,
 * …) because the immediate parent is often a short-lived shim (cmd.exe /C
 * wrappers, transient launchers) that exits the moment the hook returns —
 * dead by click time. Trying every chain entry survives shim death as long
 * as ONE PID is still alive.
 *
 * Why also walk parents from each: deals with the case where the alive PID
 * itself is a CLI process (no window) — its terminal-host ancestor is the
 * one that actually owns the window.
 */
function focusWindowByPid(startPids: number[]): Promise<boolean> {
  const pidList = startPids.map((p) => Math.floor(p)).join(',');
  const script = `
$startPids = @(${pidList})
try {
  Add-Type -ErrorAction Stop -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class APFocusPid {
  public delegate bool WNDENUMPROC(IntPtr h, IntPtr lp);
  [DllImport("user32.dll")] public static extern bool EnumWindows(WNDENUMPROC cb, IntPtr lp);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();

  public static IntPtr FindForPid(int pid) {
    IntPtr found = IntPtr.Zero;
    var cb = new WNDENUMPROC((h, lp) => {
      if (!IsWindowVisible(h)) return true;
      uint p; GetWindowThreadProcessId(h, out p);
      if ((int)p == pid) { found = h; return false; }
      return true;
    });
    EnumWindows(cb, IntPtr.Zero);
    GC.KeepAlive(cb);
    return found;
  }

  public static bool ForceForeground(IntPtr hwnd) {
    ShowWindow(hwnd, 9); // SW_RESTORE
    uint targetPid;
    uint targetThread = GetWindowThreadProcessId(hwnd, out targetPid);
    uint forePid;
    uint foreThread = GetWindowThreadProcessId(GetForegroundWindow(), out forePid);
    uint currentThread = GetCurrentThreadId();
    bool attachedToFore = false, attachedToTarget = false;
    try {
      if (foreThread != currentThread) attachedToFore = AttachThreadInput(currentThread, foreThread, true);
      if (targetThread != currentThread && targetThread != foreThread)
        attachedToTarget = AttachThreadInput(currentThread, targetThread, true);
      return SetForegroundWindow(hwnd);
    } finally {
      if (attachedToFore)   AttachThreadInput(currentThread, foreThread, false);
      if (attachedToTarget) AttachThreadInput(currentThread, targetThread, false);
    }
  }
}
"@
  $hwnd = [IntPtr]::Zero
  $walked = New-Object System.Collections.ArrayList
  $matchedPid = 0
  # Pass 1: a window owned directly by ANY start PID. GUI process groups
  # (Electron apps like Codex) include the window owner as a SIBLING of the
  # other start PIDs — walking one PID's ancestors first can escape the app
  # into whatever launched it (e.g. a browser that handled the app's URI
  # scheme) and foreground that instead.
  foreach ($startPid in $startPids) {
    $hwnd = [APFocusPid]::FindForPid([int]$startPid)
    if ($hwnd -ne [IntPtr]::Zero) { $matchedPid = [int]$startPid; break }
  }
  # Pass 2: no start PID owns a window (CLI processes never do) — walk each
  # one's parent chain to the window-owning host (e.g. the terminal).
  if ($hwnd -eq [IntPtr]::Zero) {
    foreach ($startPid in $startPids) {
      $current = [int]$startPid
      for ($i = 0; $i -lt 10; $i++) {
        if ($current -le 0) { break }
        [void]$walked.Add($current)
        $hwnd = [APFocusPid]::FindForPid($current)
        if ($hwnd -ne [IntPtr]::Zero) { $matchedPid = $current; break }
        try {
          $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$current" -ErrorAction Stop
          if (-not $proc) { break }
          $current = [int]$proc.ParentProcessId
        } catch { break }
      }
      if ($hwnd -ne [IntPtr]::Zero) { break }
    }
  }
  if ($hwnd -eq [IntPtr]::Zero) {
    Write-Output ("0:no_window:walked=" + ($walked -join ','))
    exit
  }
  $ok = [APFocusPid]::ForceForeground($hwnd)
  # \${var}: PS braces required — bare $hwnd:pid would be parsed as a scoped
  # variable reference and render empty.
  Write-Output ("1:hwnd=\${hwnd}:pid=\${matchedPid}:ok=\${ok}:walked=" + ($walked -join ','))
} catch {
  Write-Output "0:err:$($_.ToString().Split([char]10)[0])"
}`.trim();

  const encoded = Buffer.from(script, 'utf16le').toString('base64');

  return new Promise<boolean>((resolve) => {
    execFile(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded],
      (err, stdout, stderr) => {
        const out = stdout.trim();
        if (err) {
          logger.warn('[BubbleManager] focus-by-pid PS error:', stderr?.trim() || err.message);
          resolve(false);
          return;
        }
        const focused = out.startsWith('1:');
        logger.info(`[BubbleManager] focus-by-pid result → ${out}`);
        resolve(focused);
      },
    );
  });
}

function getAppIconPath(): string {
  return path.join(
    app.getAppPath(),
    'public',
    'assets',
    'favicon',
    'android-chrome-512x512.png',
  );
}

export class BubbleManager {
  private bubbles: Map<ToolId, BrowserWindow> = new Map();

  private static readonly EDGE_PADDING = 20;
  private static readonly STACK_GAP = 4;

  // Live dimensions + anchor, derived from the user's BubbleConfig. Mutated by
  // applyConfig() and read everywhere a window is sized or placed.
  private width = BUBBLE_DIMENSIONS.medium.width;
  private height = BUBBLE_DIMENSIONS.medium.height;
  private tooltipHeight = BUBBLE_DIMENSIONS.medium.tooltip;
  private size: BubbleSize = 'medium';
  // When true, the Claude bubble uses the larger MASCOT_DIMENSIONS footprint.
  private mascotClaudeCode = false;
  // When true, the Codex bubble uses the larger MASCOT_DIMENSIONS_CODEX footprint.
  private mascotOpenaiCodex = false;
  // When true, the Antigravity bubble uses the larger MASCOT_DIMENSIONS_ANTIGRAVITY footprint.
  private mascotAntigravity = false;
  private stackPosition: BubbleStackPosition = 'bottom-right';
  private anchor: BubbleAnchor | null = null;
  private displayId: number | null = null;
  private displayMatch: BubbleDisplayMatch | null = null;
  // Master visibility switch. When true, every bubble window is hidden via
  // win.hide() — but the windows (and their renderers) stay alive, so the
  // bridge, hooks, pollers, and guardrails keep running untouched. restack and
  // create both gate visibility on this so a hidden bubble is never re-shown.
  private hidden = false;

  // Set by the app shell so a drag-end can persist the new anchor into
  // user-config without BubbleManager owning config I/O.
  public onAnchorChange: ((anchor: BubbleAnchor) => void) | null = null;

  // Fired when the saved display id went stale (ids regenerate across
  // reboots) but the same physical monitor was re-found by label/bounds —
  // the app shell persists the fresh id so Settings highlights correctly
  // and the next lookup is exact again.
  public onDisplayRehome: ((displayId: number, match: BubbleDisplayMatch) => void) | null = null;

  // Set by the app shell to expose the bridge's authoritative tool status.
  // The renderer's copy is a downstream mirror fed by status-update pushes,
  // so it can miss PIDs (e.g. ones rehydrated at boot before any broadcast);
  // focus-tool consults this first.
  public getToolStatus: ((toolId: ToolId) => ToolStatus | undefined) | null = null;

  constructor(config?: BubbleConfig) {
    if (config) this.applyDims(config);
  }

  private applyDims(config: BubbleConfig) {
    const d = BUBBLE_DIMENSIONS[config.size] ?? BUBBLE_DIMENSIONS.medium;
    this.size = BUBBLE_DIMENSIONS[config.size] ? config.size : 'medium';
    this.width = d.width;
    this.height = d.height;
    this.tooltipHeight = d.tooltip;
    this.mascotClaudeCode = config.mascotClaudeCode ?? false;
    this.mascotOpenaiCodex = config.mascotOpenaiCodex ?? false;
    this.mascotAntigravity = config.mascotAntigravity ?? false;
    this.stackPosition = config.stackPosition;
    this.anchor = config.anchor ?? null;
    this.displayId = config.displayId ?? null;
    this.displayMatch = config.displayMatch ?? null;
    this.hidden = config.hidden ?? false;
  }

  // Window footprint for a given tool. The Claude bubble grows to the mascot
  // size when the mascot is enabled; every other bubble uses the standard
  // size. Used everywhere a window is sized, placed, or stacked.
  private dimsFor(toolId: ToolId): { width: number; height: number } {
    if (toolId === 'claude-code' && this.mascotClaudeCode) {
      const m = MASCOT_DIMENSIONS[this.size] ?? MASCOT_DIMENSIONS.medium;
      return { width: m.width, height: m.height };
    }
    if (toolId === 'openai-codex' && this.mascotOpenaiCodex) {
      const m = MASCOT_DIMENSIONS_CODEX[this.size] ?? MASCOT_DIMENSIONS_CODEX.medium;
      return { width: m.width, height: m.height };
    }
    if (toolId === 'antigravity-cli' && this.mascotAntigravity) {
      const m = MASCOT_DIMENSIONS_ANTIGRAVITY[this.size] ?? MASCOT_DIMENSIONS_ANTIGRAVITY.medium;
      return { width: m.width, height: m.height };
    }
    return { width: this.width, height: this.height };
  }

  // The user's chosen monitor, or undefined when unset/currently unplugged
  // (caller falls back to primary). Display ids are not reboot-stable, so a
  // failed id lookup retries by the persisted label, tie-breaking duplicate
  // models by bounds origin, then by the full bounds rect (covers monitors
  // that report no label). A label/bounds hit heals the in-memory id and
  // notifies the shell to persist it.
  private resolvePreferredDisplay(): Electron.Display | undefined {
    if (this.displayId == null && !this.displayMatch) return undefined;
    const displays = screen.getAllDisplays();
    const byId = displays.find((d) => d.id === this.displayId);
    if (byId) return byId;

    const m = this.displayMatch;
    if (!m) return undefined;
    const labeled = m.label ? displays.filter((d) => d.label === m.label) : [];
    const match =
      labeled.find((d) => d.bounds.x === m.bounds.x && d.bounds.y === m.bounds.y) ??
      labeled[0] ??
      displays.find(
        (d) =>
          d.bounds.x === m.bounds.x &&
          d.bounds.y === m.bounds.y &&
          d.bounds.width === m.bounds.width &&
          d.bounds.height === m.bounds.height,
      );
    if (!match) return undefined;

    logger.info(
      `[BubbleManager] display id ${this.displayId} stale; re-found "${m.label || 'unlabeled'}" as id ${match.id}`,
    );
    this.displayId = match.id;
    this.onDisplayRehome?.(match.id, {
      label: match.label ?? '',
      bounds: { x: match.bounds.x, y: match.bounds.y, width: match.bounds.width, height: match.bounds.height },
    });
    return match;
  }

  // Re-apply size/position prefs to every live bubble. Called when the user
  // changes appearance in Settings — restack repositions and resizes in place.
  public applyConfig(config: BubbleConfig) {
    logger.debug('[BubbleManager] applyConfig:', JSON.stringify(config));
    this.applyDims(config);
    this.restackBubbles('applyConfig');
  }

  private isUsableBubble(window: BrowserWindow): boolean {
    return !window.isDestroyed() && !window.webContents.isDestroyed();
  }

  // Resize/move a bubble window, briefly relaxing the min/max clamp (set at
  // creation to block WM resizes) so growing past the old max — or shrinking
  // below the old min — isn't rejected. Order-independent for grow vs shrink.
  private applyBounds(window: BrowserWindow, x: number, y: number, width: number, height: number) {
    window.setMinimumSize(1, 1);
    window.setMaximumSize(10000, 10000);
    window.setBounds({ x, y, width, height });
    window.setMinimumSize(width, height);
    window.setMaximumSize(width, height);
  }

  // Position the bubble whose footprint is `dims`, `offset` px into the stack
  // (the summed height of every bubble before it, plus gaps). Per-bubble dims
  // let a taller bubble — e.g. the Claude mascot — stack cleanly with the rest.
  private getStackPosition(offset: number, dims: { width: number; height: number }) {
    if (this.anchor) {
      // Drag-placed anchor: global DIP point, so it addresses any monitor.
      // getDisplayNearestPoint resolves the display it lives on; if that
      // monitor was unplugged it returns the closest remaining one, and the
      // clamp below pulls the stack fully into its work area instead of
      // stranding bubbles off-screen.
      const { workArea } = screen.getDisplayNearestPoint(this.anchor);
      const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), Math.max(min, max));
      const x = clamp(this.anchor.x, workArea.x, workArea.x + workArea.width - dims.width);
      const baseY = clamp(this.anchor.y, workArea.y, workArea.y + workArea.height - dims.height);
      // Grow toward the vertical center (mirrors the corner presets): anchors
      // in the top half stack downward, bottom half stack upward.
      const growDown = baseY < workArea.y + workArea.height / 2;
      const y = growDown ? baseY + offset : baseY - offset;
      return { x, y };
    }

    // Corner preset: honor the user's chosen monitor. If that monitor is
    // gone (unplugged, sleeping dock), fall back to the primary display —
    // the display-removed listener restacks, so bubbles hop back as soon as
    // it disappears and return when it's re-added.
    const { workArea } = this.resolvePreferredDisplay() ?? screen.getPrimaryDisplay();
    const onLeft = this.stackPosition === 'bottom-left' || this.stackPosition === 'top-left';
    const onTop = this.stackPosition === 'top-left' || this.stackPosition === 'top-right';

    const x = onLeft
      ? workArea.x + BubbleManager.EDGE_PADDING
      : workArea.x + workArea.width - dims.width - BubbleManager.EDGE_PADDING;

    const y = onTop
      ? workArea.y + BubbleManager.EDGE_PADDING + offset
      : workArea.y + workArea.height - dims.height - BubbleManager.EDGE_PADDING - offset;

    return { x, y };
  }

  private pruneDeadBubbles(reason: string) {
    for (const [toolId, window] of this.bubbles.entries()) {
      if (this.isUsableBubble(window)) continue;
      logger.debug(`[BubbleManager] pruning dead bubble for ${toolId} during ${reason}: ${this.describeWindow(window)}`);
      this.bubbles.delete(toolId);
    }
  }

  private restackBubbles(reason: string) {
    this.pruneDeadBubbles(`restack:${reason}`);
    // Cumulative px consumed by bubbles already placed, so a taller bubble
    // (the mascot) shifts the rest of the stack by its real height.
    let offset = 0;

    for (const [toolId, window] of this.bubbles.entries()) {
      const dims = this.dimsFor(toolId);
      const { x, y } = this.getStackPosition(offset, dims);
      const bounds = window.getBounds();
      if (
        bounds.x !== x ||
        bounds.y !== y ||
        bounds.width !== dims.width ||
        bounds.height !== dims.height
      ) {
        logger.debug(
          `[BubbleManager] restacking ${toolId} for ${reason}: from=${JSON.stringify(bounds)} to=${JSON.stringify({ x, y, width: dims.width, height: dims.height })}`,
        );
        this.applyBounds(window, x, y, dims.width, dims.height);
      }

      offset += dims.height + BubbleManager.STACK_GAP;

      if (this.hidden) {
        if (window.isVisible()) {
          logger.debug(`[BubbleManager] hiding bubble for ${toolId} during ${reason} (master hide on)`);
          window.hide();
        }
      } else if (!window.isVisible()) {
        logger.debug(`[BubbleManager] showing hidden bubble for ${toolId} during ${reason}`);
        window.showInactive();
      }
    }

    this.logBubbleInventory(`restack:${reason}`);
  }

  private describeWindow(window: BrowserWindow): string {
    if (window.isDestroyed()) {
      return `id=${window.id} destroyed=true`;
    }

    const bounds = window.getBounds();
    const url = window.webContents.isDestroyed()
      ? '<webContents destroyed>'
      : window.webContents.getURL();

    return [
      `id=${window.id}`,
      `title="${window.getTitle()}"`,
      `visible=${window.isVisible()}`,
      `minimized=${window.isMinimized()}`,
      `destroyed=${window.isDestroyed()}`,
      `webContentsDestroyed=${window.webContents.isDestroyed()}`,
      `bounds=${JSON.stringify(bounds)}`,
      `url="${url}"`,
    ].join(' ');
  }

  private logBubbleInventory(reason: string) {
    const entries = Array.from(this.bubbles.entries()).map(([toolId, window]) => {
      return `${toolId}: ${this.describeWindow(window)}`;
    });
    logger.debug(
      `[BubbleManager] inventory after ${reason}: count=${this.bubbles.size}` +
        (entries.length ? ` | ${entries.join(' | ')}` : ''),
    );
  }

  public init() {
    ipcMain.on('set-ignore-mouse', (event, { ignore }: { ignore: boolean }) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return;
      win.setIgnoreMouseEvents(ignore, { forward: true });
    });

    ipcMain.on(
      'move-bubble',
      (event, { dx, dy }: { dx: number; dy: number }) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (!win) return;
        // The stack moves as one unit: dragging any bubble shifts every bubble
        // by the same delta, so the column the user placed is what gets
        // remembered on drag-end (individual offsets were never persisted and
        // restack would snap them back into a column anyway).
        for (const [toolId, window] of this.bubbles.entries()) {
          if (!this.isUsableBubble(window)) continue;
          const bounds = window.getBounds();
          const dims = this.dimsFor(toolId);
          // Use setBounds to enforce size on every move — prevents Windows WM resize
          window.setBounds({
            x: bounds.x + dx,
            y: bounds.y + dy,
            width: dims.width,
            height: dims.height,
          });
        }
      },
    );

    // Fired once on mouse-up after a real drag. The stack moved rigidly, so
    // the top-of-stack (insertion-order first) bubble's position IS the new
    // anchor. Persisting goes through the app shell → user-config → back into
    // applyConfig, whose restack clamps the anchor onto a live display and
    // re-derives the grow direction.
    ipcMain.on('bubble-drag-end', () => {
      this.pruneDeadBubbles('drag-end');
      const first = this.bubbles.values().next().value as BrowserWindow | undefined;
      if (!first || !this.isUsableBubble(first)) return;
      const { x, y } = first.getBounds();
      this.anchor = { x, y };
      logger.info(`[BubbleManager] drag-end → anchor (${x}, ${y})`);
      this.onAnchorChange?.(this.anchor);
    });

    // Monitor hotplug / resolution / taskbar changes: restack so a drag-placed
    // anchor on a vanished display clamps onto the nearest remaining one and
    // corner presets track the new work area. metrics-changed fires in bursts
    // while Windows settles a DPI/resolution switch, hence the debounce.
    let displayDebounce: NodeJS.Timeout | null = null;
    const onDisplayChange = (event: string) => {
      if (displayDebounce) clearTimeout(displayDebounce);
      displayDebounce = setTimeout(() => {
        displayDebounce = null;
        this.restackBubbles(`display:${event}`);
      }, 300);
    };
    screen.on('display-added', () => onDisplayChange('added'));
    screen.on('display-removed', () => onDisplayChange('removed'));
    screen.on('display-metrics-changed', () => onDisplayChange('metrics-changed'));

    ipcMain.on(
      'focus-tool',
      (
        _event,
        {
          toolId,
          agentPid,
          agentPidChain,
        }: { toolId: ToolId; agentPid?: number; agentPidChain?: number[] },
      ) => {
        // Prefer the main-process state manager over the renderer payload:
        // it's the source the renderer mirrors, and it also holds PIDs
        // rehydrated from the timeline DB that were never broadcast.
        const latched = this.getToolStatus?.(toolId);
        const pid = latched?.agentPid ?? agentPid;
        const chain = latched?.agentPidChain?.length ? latched.agentPidChain : agentPidChain;
        focusTool(toolId, pid, chain).catch((err) =>
          logger.warn('[BubbleManager] focus-tool error:', err),
        );
      },
    );

    ipcMain.on('bubble-hover', (event, { hovered }: { hovered: boolean }) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return;
      const [x, y] = win.getPosition();
      const entry = [...this.bubbles.entries()].find(([, w]) => w === win);
      const dims = entry ? this.dimsFor(entry[0]) : { width: this.width, height: this.height };
      const totalHeight = dims.height + this.tooltipHeight;
      if (hovered) {
        // Relax max constraint, expand upward so the bubble stays in place
        win.setMaximumSize(dims.width, totalHeight);
        win.setSize(dims.width, totalHeight);
        win.setPosition(x, y - this.tooltipHeight);
      } else {
        win.setPosition(x, y + this.tooltipHeight);
        win.setSize(dims.width, dims.height);
        win.setMaximumSize(dims.width, dims.height);
      }
    });
  }

  public createBubble(toolId: ToolId) {
    this.pruneDeadBubbles(`create:${toolId}`);

    const existing = this.bubbles.get(toolId);
    if (existing) {
      if (!existing.isVisible() && !this.hidden) {
        logger.debug(`[BubbleManager] createBubble found hidden existing bubble for ${toolId}; showing it`);
        existing.showInactive();
      }
      this.restackBubbles(`create-existing:${toolId}`);
      logger.debug(
        `[BubbleManager] createBubble ignored for ${toolId}; existing ${this.describeWindow(existing)}`,
      );
      return;
    }

    // Stack from the chosen corner, each new bubble beyond the previous. Sum
    // the real heights of existing bubbles so a taller mascot bubble doesn't
    // overlap the rest (restackBubbles below reconciles every position anyway).
    let offset = 0;
    for (const [tid] of this.bubbles) offset += this.dimsFor(tid).height + BubbleManager.STACK_GAP;
    const dims = this.dimsFor(toolId);
    const { x, y } = this.getStackPosition(offset, dims);

    logger.debug(
      `[BubbleManager] createBubble requested: toolId=${toolId} offset=${offset} x=${x} y=${y} w=${dims.width} h=${dims.height}`,
    );

    const window = new BrowserWindow({
      title: `Agent Pulse - ${toolId}`,
      x,
      y,
      width: dims.width,
      height: dims.height,
      minWidth: dims.width,
      minHeight: dims.height,
      maxWidth: dims.width,
      maxHeight: dims.height,
      // When master hide is on, start hidden so a new bubble never flashes
      // on-screen before the restack below reconciles visibility.
      show: !this.hidden,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: false,
      movable: false,
      hasShadow: false,
      skipTaskbar: true,
      icon: getAppIconPath(),
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js'),
      },
    });

    logger.debug(`[BubbleManager] created bubble ${toolId}: ${this.describeWindow(window)}`);

    // Windows ignores resizable:false on frameless windows — block at the event level
    window.on('will-resize', (e) => {
      logger.debug(`[BubbleManager] will-resize blocked for ${toolId}: ${this.describeWindow(window)}`);
      e.preventDefault();
    });

    window.on('close', (event) => {
      logger.debug(
        `[BubbleManager] close event for ${toolId}: defaultPrevented=${event.defaultPrevented} ${this.describeWindow(window)}`,
      );
    });

    window.on('closed', () => {
      logger.debug(`[BubbleManager] closed event for ${toolId}: id=${window.id}`);
      const current = this.bubbles.get(toolId);
      if (current === window) {
        this.bubbles.delete(toolId);
      }
      this.logBubbleInventory(`closed:${toolId}`);
    });

    window.on('hide', () => {
      logger.debug(`[BubbleManager] hide event for ${toolId}: ${this.describeWindow(window)}`);
    });

    window.on('show', () => {
      logger.debug(`[BubbleManager] show event for ${toolId}: ${this.describeWindow(window)}`);
    });

    window.on('minimize', () => {
      logger.debug(`[BubbleManager] minimize event for ${toolId}: ${this.describeWindow(window)}`);
    });

    window.on('unresponsive', () => {
      logger.warn(`[BubbleManager] unresponsive event for ${toolId}: ${this.describeWindow(window)}`);
    });

    window.on('responsive', () => {
      logger.debug(`[BubbleManager] responsive event for ${toolId}: ${this.describeWindow(window)}`);
    });

    window.webContents.on('render-process-gone', (_event, details) => {
      logger.error(
        `[BubbleManager] render-process-gone for ${toolId}: reason=${details.reason} exitCode=${details.exitCode} ${this.describeWindow(window)}`,
      );
    });

    window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
      logger.error(
        `[BubbleManager] did-fail-load for ${toolId}: code=${errorCode} description="${errorDescription}" url="${validatedURL}"`,
      );
    });

    window.webContents.on('did-finish-load', () => {
      logger.debug(`[BubbleManager] did-finish-load for ${toolId}: ${this.describeWindow(window)}`);
    });

    window.webContents.on('destroyed', () => {
      logger.debug(`[BubbleManager] webContents destroyed for ${toolId}: windowId=${window.id}`);
    });

    // Start click-through; renderer will toggle per-pixel via 'set-ignore-mouse'
    window.setIgnoreMouseEvents(true, { forward: true });
    logger.debug(`[BubbleManager] setIgnoreMouseEvents(true) for ${toolId}`);

    if (!app.isPackaged) {
      const url = `http://localhost:5173/bubble?toolId=${toolId}`;
      logger.debug(`[BubbleManager] loading bubble ${toolId}: ${url}`);
      window.loadURL(url);
    } else {
      logger.debug(`[BubbleManager] loading packaged bubble ${toolId}`);
      window.loadFile(path.join(app.getAppPath(), 'dist', 'renderer', 'index.html'), {
        query: { toolId },
      });
    }

    // Forward bubble console output to the main process so logs from the
    // tiny click-through window are visible without opening DevTools on it.
    if (!app.isPackaged) {
      window.webContents.on('console-message', (...args: any[]) => {
        const params = args[0];
        const level = typeof params?.level === 'string' ? params.level : args[1];
        const message = typeof params?.message === 'string' ? params.message : args[2];
        const line = typeof params?.lineNumber === 'number' ? params.lineNumber : args[3];
        const sourceId = typeof params?.sourceId === 'string' ? params.sourceId : args[4];
        if (typeof message === 'string' && (message.includes('[Bubble:') || message.includes('chime'))) {
          logger.debug(`[bubble:${toolId}] ${message} (${sourceId}:${line}, level=${level})`);
        }
      });
    }

    this.bubbles.set(toolId, window);
    this.restackBubbles(`create:${toolId}`);
    this.logBubbleInventory(`create:${toolId}`);
  }

  public destroyBubble(toolId: ToolId) {
    const window = this.bubbles.get(toolId);
    if (window) {
      logger.debug(`[BubbleManager] destroyBubble requested for ${toolId}: ${this.describeWindow(window)}`);
      window.close();
      this.bubbles.delete(toolId);
      this.logBubbleInventory(`destroy-request:${toolId}`);
    } else {
      logger.warn(`[BubbleManager] destroyBubble requested for ${toolId}, but no bubble is registered`);
    }
  }

  public getBubbleStates(): Partial<Record<ToolId, boolean>> {
    this.pruneDeadBubbles('getBubbleStates');

    const states: Partial<Record<ToolId, boolean>> = {};
    for (const [toolId, window] of this.bubbles.entries()) {
      // While master hide is on, every window is intentionally hidden — report
      // it as enabled anyway so the per-tool toggles in Settings keep showing
      // the tool's tracking state instead of all flipping off.
      states[toolId] = this.isUsableBubble(window) && (this.hidden || window.isVisible());
    }

    logger.debug('[BubbleManager] getBubbleStates:', JSON.stringify(states));
    return states;
  }

  public syncEnabledBubbles(enabledBubbles: Partial<Record<ToolId, boolean>>) {
    logger.debug('[BubbleManager] syncEnabledBubbles requested:', JSON.stringify(enabledBubbles));
    this.pruneDeadBubbles('syncEnabledBubbles');

    (Object.keys(enabledBubbles) as ToolId[]).forEach((toolId) => {
      if (enabledBubbles[toolId]) {
        this.createBubble(toolId);
      } else if (this.bubbles.has(toolId)) {
        this.destroyBubble(toolId);
      }
    });

    this.restackBubbles('syncEnabledBubbles');
    return this.getBubbleStates();
  }
}
