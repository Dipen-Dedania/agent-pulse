import { BacklogAgent } from '../../../common/backlog-types';
import { AgentAdapter } from './types';
import { claudeAdapter } from './claude';
import { codexAdapter } from './codex';

export * from './types';
export { isSafeSessionId, RESUME_PROMPT } from './shared';
export { claudeAdapter } from './claude';
export { codexAdapter } from './codex';

const ADAPTERS: Record<BacklogAgent, AgentAdapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
};

/** The adapter for a card's agent. Unknown values were normalized away by the store. */
export function adapterFor(agent: BacklogAgent): AgentAdapter {
  return ADAPTERS[agent] ?? claudeAdapter;
}

/** Which agents have a usable CLI right now (setup checklist / editor gating). */
export function agentAvailability(): Record<BacklogAgent, boolean> {
  return {
    claude: claudeAdapter.resolveBin() !== null,
    codex: codexAdapter.resolveBin() !== null,
  };
}
