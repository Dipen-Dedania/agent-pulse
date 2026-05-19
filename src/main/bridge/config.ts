// Bridge transport config — shared by the HTTP server and the hook script
// generator so both sides agree on which port to use.
//
// Override with `AGENT_PULSE_PORT=<n>` (set before launching the app, e.g. in a
// shortcut or the user's shell profile). Hook scripts bake the URL in at install
// time, so changing the port requires reinstalling hooks from Settings.

import { logger } from '../../common/logger';

const DEFAULT_PORT = 4242;

function resolvePort(): number {
  const raw = process.env.AGENT_PULSE_PORT;
  if (!raw) return DEFAULT_PORT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    logger.warn(`[BridgeConfig] Ignoring invalid AGENT_PULSE_PORT="${raw}", falling back to ${DEFAULT_PORT}`);
    return DEFAULT_PORT;
  }
  return n;
}

export const BRIDGE_PORT = resolvePort();
export const BRIDGE_URL  = `http://localhost:${BRIDGE_PORT}/event`;
