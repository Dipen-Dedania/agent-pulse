import React, { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, SettingRow } from '../Shared';

// Settings → Plans & Limits → Claude Code: connect the Agent Pulse MCP server
// to Claude Code so a terminal chat can drop work straight onto the board ("add
// that to my backlog"). Stays under Claude Code (unlike issue population, now
// under ⚙ on the board) because it registers an MCP server in ~/.claude.json —
// a Claude Code feature, not a board-wide one.
//
// Registration writes ~/.claude.json (user scope, so it works in every repo)
// and, when Codex CLI is installed, a [mcp_servers.agent-pulse] table in
// ~/.codex/config.toml. One Connect keeps both in sync; main/mcp/install.ts
// owns the file surgery and this component only reflects its status.

interface CodexMcpStatus {
  detected: boolean;
  installed: boolean;
  current: boolean;
  configPath: string;
  error?: string;
}

interface McpInstallStatus {
  installed: boolean;
  current: boolean;
  configPath: string;
  scriptPath: string;
  error?: string;
  codex?: CodexMcpStatus;
}

export const BacklogMcpSection: React.FC = () => {
  const [status, setStatus] = useState<McpInstallStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const next = await window.electron.invoke('backlog:mcp-status');
    setStatus(next ?? null);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const run = async (channel: 'backlog:mcp-install' | 'backlog:mcp-uninstall', okNote: string) => {
    setBusy(true);
    setNote(null);
    try {
      const res = await window.electron.invoke(channel);
      setNote(res?.ok ? okNote : (res?.reason ?? 'that did not work'));
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  // "Installed but not current" means the entry points at a different binary or
  // script than this build — usually an app update or a moved install. Re-running
  // install rewrites it, so the button stays enabled and says so. Codex counts
  // only when it is on this machine; a missing Codex entry makes it a reconnect.
  const codex = status?.codex;
  const showCodex = !!codex && (codex.detected || codex.installed);
  const claudeConnected = !!status?.installed && !!status?.current;
  const codexConnected = !!codex?.installed && !!codex?.current;
  const connected = claudeConnected && (!codex?.detected || codexConnected);
  const stale = !connected && (!!status?.installed || !!codex?.installed);
  const clients = showCodex ? 'Claude Code or Codex' : 'Claude Code';

  return (
    <Card
      title={showCodex ? 'Capture from Claude Code & Codex' : 'Capture from Claude Code'}
      subtitle={
        <>
          Connect Agent Pulse to {clients} as an MCP server, then say
          <span className='text-body'> “add that to my backlog”</span> in any terminal chat. The agent writes the
          card from what you just discussed — title, brief and acceptance criteria — and it lands in
          <span className='text-body'> To-Do</span>, ready for the overnight scheduler. Works in any git repo;
          the repo registers itself as a project the first time.
        </>
      }
      right={
        <Badge tone={connected ? 'ok' : stale ? 'warn' : 'neutral'} variant='pill' dot>
          {connected ? 'Connected' : stale ? 'Needs reconnect' : 'Not connected'}
        </Badge>
      }
    >
      <SettingRow
        className='mt-4'
        title={claudeConnected ? 'Registered with Claude Code' : status?.installed ? 'Claude Code: pointing at an old install' : 'Claude Code: not registered yet'}
        description={
          status?.error
            ? status.error
            : claudeConnected
              ? 'Start a new Claude Code session to pick it up — sessions read the config at launch.'
              : 'Adds an “agent-pulse” entry to ~/.claude.json. Close open Claude Code sessions first; a running session rewrites that file when it exits.'
        }
        control={
          connected ? (
            <Button variant='secondary' size='sm' disabled={busy} onClick={() => run('backlog:mcp-uninstall', 'Disconnected.')}>
              Disconnect
            </Button>
          ) : (
            <div className='flex gap-2'>
              {stale && (
                <Button variant='secondary' size='sm' disabled={busy} onClick={() => run('backlog:mcp-uninstall', 'Disconnected.')}>
                  Disconnect
                </Button>
              )}
              <Button size='sm' disabled={busy} onClick={() => run('backlog:mcp-install', `Connected — start a new ${clients} session.`)}>
                {stale ? 'Reconnect' : 'Connect'}
              </Button>
            </div>
          )
        }
      />

      {showCodex && codex && (
        <SettingRow
          className='mt-3'
          title={codexConnected ? 'Registered with Codex' : codex.installed ? 'Codex: pointing at an old install' : 'Codex: not registered yet'}
          description={
            codex.error
              ? codex.error
              : codexConnected
                ? 'Start a new Codex session to pick it up — Codex loads MCP servers at session start.'
                : `Adds an [mcp_servers.agent-pulse] table to ${codex.configPath}; every other line is left as is.`
          }
          control={
            <Badge tone={codexConnected ? 'ok' : codex.installed || codex.error ? 'warn' : 'neutral'} variant='pill' dot>
              {codexConnected ? 'Connected' : codex.installed ? 'Stale' : 'Not connected'}
            </Badge>
          }
        />
      )}

      {note && <p className='mt-3 text-xs text-muted'>{note}</p>}

      <p className='mt-3 text-[11px] text-faint'>
        Cards arrive as green risk by default, which makes them eligible to run unattended. Agent Pulse must be
        running for capture to work — the MCP server talks to it over the local bridge.
      </p>
    </Card>
  );
};
