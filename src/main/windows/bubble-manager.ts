import { BrowserWindow, ipcMain, screen, app } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { execFile } from 'child_process';
import open, { openApp } from 'open';
import { ToolId } from '../../common/types';
import { logger } from '../../common/logger';

// ─── macOS / Linux ────────────────────────────────────────────────────────────
// macOS: `open -a <name>` activates the existing window (or launches if not running)
// Linux: binary name executed directly
const TOOL_APP_NAME: Record<ToolId, { mac: string; linux: string }> = {
  'cursor':         { mac: 'Cursor',             linux: 'cursor' },
  'vscode-copilot': { mac: 'Visual Studio Code', linux: 'code' },
  'claude-code':    { mac: 'Terminal',            linux: 'x-terminal-emulator' },
  'openai-codex':   { mac: 'Terminal',            linux: 'x-terminal-emulator' },
  'antigravity-cli':{ mac: 'Terminal',            linux: 'x-terminal-emulator' },
  'kiro':           { mac: 'Kiro',                linux: 'kiro' },
};

// ─── Windows ─────────────────────────────────────────────────────────────────
// Process names to search for each tool, in priority order.
// GUI tools: their own process name (Cursor, Code, Kiro).
// Terminal tools: the CLI process first, then common terminal hosts as fallback.
// EnumWindows returns windows front→back (Z-order), so the first match is always
// the most-recently-active window — correct when multiple instances are open.
const TOOL_WIN_PROCESS_NAMES: Record<ToolId, string[]> = {
  'cursor':         ['Cursor'],
  'vscode-copilot': ['Code'],
  'kiro':           ['Kiro'],
  'claude-code':    ['claude', 'WindowsTerminal', 'pwsh', 'powershell', 'cmd'],
  'openai-codex':   ['codex',  'WindowsTerminal', 'pwsh', 'powershell', 'cmd'],
  'antigravity-cli':['agy', 'WindowsTerminal', 'pwsh', 'powershell', 'cmd'],
};

// Fallback launch paths for GUI tools that aren't running yet.
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
    uint foreThread = GetWindowThreadProcessId(GetForegroundWindow(), out _);
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
  Write-Output "1:hwnd=$hwnd:ok=$ok"
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
        logger.debug(`[BubbleManager] focus result → ${out}`);
        resolve(focused);
      },
    );
  });
}

async function focusTool(toolId: ToolId): Promise<void> {
  const platform = process.platform;
  logger.debug(`[BubbleManager] focus-tool: toolId=${toolId} platform=${platform}`);

  try {
    if (platform === 'win32') {
      const processNames = TOOL_WIN_PROCESS_NAMES[toolId];
      const focused = await focusWindowsByProcessNames(processNames);

      if (!focused) {
        // Nothing matched — try launching only if we know the GUI exe path.
        // (Terminal tools have no exe path → we just give up rather than
        // spawning a stray terminal.)
        const exePath = resolveWindowsExe(toolId);
        if (exePath) {
          logger.debug(`[BubbleManager] not running, launching: ${exePath}`);
          await open(exePath);
        } else {
          logger.warn(`[BubbleManager] no window found and no launch path for ${toolId}`);
        }
      }
    } else {
      const appName = platform === 'darwin'
        ? TOOL_APP_NAME[toolId]?.mac
        : TOOL_APP_NAME[toolId]?.linux;
      if (!appName) return;
      logger.debug(`[BubbleManager] openApp("${appName}")`);
      await openApp(appName);
    }
    logger.debug(`[BubbleManager] focus-tool done for ${toolId}`);
  } catch (err) {
    logger.warn(`[BubbleManager] focus-tool failed for ${toolId}:`, err);
  }
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

  // Width matches the orb area; height is taller so Claude's usage bars can
  // render in the bottom strip without resizing the window per-tool. Other
  // tools just leave that strip transparent.
  private static readonly BUBBLE_WIDTH = 70;
  private static readonly BUBBLE_HEIGHT = 90;
  private static readonly TOOLTIP_HEIGHT = 110;
  private static readonly EDGE_PADDING = 20;
  private static readonly STACK_GAP = 4;

  private isUsableBubble(window: BrowserWindow): boolean {
    return !window.isDestroyed() && !window.webContents.isDestroyed();
  }

  private getStackPosition(index: number) {
    const { workArea } = screen.getPrimaryDisplay();
    const x =
      workArea.x +
      workArea.width -
      BubbleManager.BUBBLE_WIDTH -
      BubbleManager.EDGE_PADDING;
    const y =
      workArea.y +
      workArea.height -
      BubbleManager.BUBBLE_HEIGHT -
      BubbleManager.EDGE_PADDING -
      index * (BubbleManager.BUBBLE_HEIGHT + BubbleManager.STACK_GAP);

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
    let index = 0;

    for (const [toolId, window] of this.bubbles.entries()) {
      const { x, y } = this.getStackPosition(index);
      const bounds = window.getBounds();
      if (
        bounds.x !== x ||
        bounds.y !== y ||
        bounds.width !== BubbleManager.BUBBLE_WIDTH ||
        bounds.height !== BubbleManager.BUBBLE_HEIGHT
      ) {
        logger.debug(
          `[BubbleManager] restacking ${toolId} for ${reason}: from=${JSON.stringify(bounds)} to=${JSON.stringify({ x, y, width: BubbleManager.BUBBLE_WIDTH, height: BubbleManager.BUBBLE_HEIGHT })}`,
        );
        window.setBounds({
          x,
          y,
          width: BubbleManager.BUBBLE_WIDTH,
          height: BubbleManager.BUBBLE_HEIGHT,
        });
      }

      if (!window.isVisible()) {
        logger.debug(`[BubbleManager] showing hidden bubble for ${toolId} during ${reason}`);
        window.showInactive();
      }

      index += 1;
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
        const bounds = win.getBounds();
        // Use setBounds to enforce size on every move — prevents Windows WM resize
        win.setBounds({
          x: bounds.x + dx,
          y: bounds.y + dy,
          width: BubbleManager.BUBBLE_WIDTH,
          height: BubbleManager.BUBBLE_HEIGHT,
        });
      },
    );

    ipcMain.on('focus-tool', (_event, { toolId }: { toolId: ToolId }) => {
      focusTool(toolId).catch((err) =>
        logger.warn('[BubbleManager] focus-tool error:', err),
      );
    });

    ipcMain.on('bubble-hover', (event, { hovered }: { hovered: boolean }) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return;
      const [x, y] = win.getPosition();
      const totalHeight =
        BubbleManager.BUBBLE_HEIGHT + BubbleManager.TOOLTIP_HEIGHT;
      if (hovered) {
        // Relax max constraint, expand upward so the bubble stays in place
        win.setMaximumSize(BubbleManager.BUBBLE_WIDTH, totalHeight);
        win.setSize(BubbleManager.BUBBLE_WIDTH, totalHeight);
        win.setPosition(x, y - BubbleManager.TOOLTIP_HEIGHT);
      } else {
        win.setPosition(x, y + BubbleManager.TOOLTIP_HEIGHT);
        win.setSize(BubbleManager.BUBBLE_WIDTH, BubbleManager.BUBBLE_HEIGHT);
        win.setMaximumSize(
          BubbleManager.BUBBLE_WIDTH,
          BubbleManager.BUBBLE_HEIGHT,
        );
      }
    });
  }

  public createBubble(toolId: ToolId) {
    this.pruneDeadBubbles(`create:${toolId}`);

    const existing = this.bubbles.get(toolId);
    if (existing) {
      if (!existing.isVisible()) {
        logger.debug(`[BubbleManager] createBubble found hidden existing bubble for ${toolId}; showing it`);
        existing.showInactive();
      }
      this.restackBubbles(`create-existing:${toolId}`);
      logger.debug(
        `[BubbleManager] createBubble ignored for ${toolId}; existing ${this.describeWindow(existing)}`,
      );
      return;
    }

    // Stack from bottom-right corner, each new bubble above the previous
    const index = this.bubbles.size;
    const { x, y } = this.getStackPosition(index);

    logger.debug(
      `[BubbleManager] createBubble requested: toolId=${toolId} index=${index} x=${x} y=${y}`,
    );

    const window = new BrowserWindow({
      title: `Agent Pulse - ${toolId}`,
      x,
      y,
      width: BubbleManager.BUBBLE_WIDTH,
      height: BubbleManager.BUBBLE_HEIGHT,
      minWidth: BubbleManager.BUBBLE_WIDTH,
      minHeight: BubbleManager.BUBBLE_HEIGHT,
      maxWidth: BubbleManager.BUBBLE_WIDTH,
      maxHeight: BubbleManager.BUBBLE_HEIGHT,
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
      states[toolId] = this.isUsableBubble(window) && window.isVisible();
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
