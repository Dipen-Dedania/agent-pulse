import React, { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, SettingRow } from '../Shared';

// Settings → Plans & Limits → Claude Code: connect the Agent Pulse MCP server
// to Claude Code so a terminal chat can drop work straight onto the board ("add
// that to my backlog"). Stays under Claude Code (unlike issue population, now
// under ⚙ on the board) because it registers an MCP server in ~/.claude.json —
// a Claude Code feature, not a board-wide one.
//
// Registration writes ~/.claude.json (user scope, so it works in every repo);
// main/mcp/install.ts owns the file surgery and this component only reflects
// its status.

interface McpInstallStatus {
  installed: boolean;
  current: boolean;
  configPath: string;
  scriptPath: string;
  error?: string;
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
  // install rewrites it, so the button stays enabled and says so.
  const connected = !!status?.installed && !!status?.current;
  const stale = !!status?.installed && !status?.current;

  return (
    <Card
      title='Capture from Claude Code'
      subtitle={
        <>
          Connect Agent Pulse to Claude Code as an MCP server, then say
          <span className='text-body'> “add that to my backlog”</span> in any terminal chat. Claude writes the
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
        title={connected ? 'Registered with Claude Code' : stale ? 'Registered, but pointing at an old install' : 'Not registered yet'}
        description={
          status?.error
            ? status.error
            : connected
              ? 'Start a new Claude Code session to pick it up — sessions read the config at launch.'
              : 'Adds an “agent-pulse” entry to ~/.claude.json. Close open Claude Code sessions first; a running session rewrites that file when it exits.'
        }
        control={
          connected ? (
            <Button variant='secondary' size='sm' disabled={busy} onClick={() => run('backlog:mcp-uninstall', 'Disconnected.')}>
              Disconnect
            </Button>
          ) : (
            <Button size='sm' disabled={busy} onClick={() => run('backlog:mcp-install', 'Connected — start a new Claude Code session.')}>
              {stale ? 'Reconnect' : 'Connect'}
            </Button>
          )
        }
      />

      {note && <p className='mt-3 text-xs text-muted'>{note}</p>}

      <p className='mt-3 text-[11px] text-faint'>
        Cards arrive as green risk by default, which makes them eligible to run unattended. Agent Pulse must be
        running for capture to work — the MCP server talks to it over the local bridge.
      </p>
    </Card>
  );
};
