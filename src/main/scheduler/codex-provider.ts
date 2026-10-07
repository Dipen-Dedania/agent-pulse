// Codex deps for the Cowork Scheduler engine: anchored on Codex's primary
// window (the 5-hour window on paid plans), token expiry from the JWT in
// ~/.codex/auth.json, `codex exec` ping, `codex-scheduler:*` IPC.
//
// `shouldSkipOpener` mirrors the Claude provider: a backlog card running on
// Codex already spends (and so anchors) the Codex window, so the ping would be
// redundant. The caller passes an agent-scoped check — a Claude card running
// must not suppress the Codex opener.

import { CodexUsageStatus } from '../../common/types';
import { CodexUsagePoller } from '../codex-usage/poller';
import { readAccessToken } from '../codex-usage/credentials';
import { Scheduler, SchedulerDeps } from './scheduler';
import { fireCodexOpener } from './codex-opener';

export type CodexScheduler = Scheduler<CodexUsageStatus>;

export function codexSchedulerDeps(
  poller: CodexUsagePoller,
  shouldSkipOpener?: () => boolean,
): SchedulerDeps<CodexUsageStatus> {
  return {
    usageSource: poller,
    anchorResetsAt: (s) => (s.state === 'ok' && s.snapshot ? s.snapshot.primary.resetsAt : null),
    readExpiry: async () => {
      const creds = await readAccessToken();
      return creds.ok && typeof creds.expiresAt === 'number' ? creds.expiresAt : null;
    },
    fire: fireCodexOpener,
    ipcPrefix: 'codex-scheduler',
    logTag: '[CodexScheduler]',
    shouldSkipOpener,
  };
}
