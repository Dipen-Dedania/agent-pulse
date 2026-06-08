// Reusable chat-webhook sender. Standalone (no app state) so any feature —
// attention escalation today, guardrail/usage notifications later — can POST a
// short message to a user-configured Discord or Slack incoming webhook.
//
// Both providers accept a simple JSON body over a plain POST:
//   Discord — { content } (markdown), optional { embeds: [...] }
//   Slack   — { text }     (mrkdwn)
// Network/HTTP failures are swallowed into a structured result; this never
// throws into the caller (the engine fires these fire-and-forget).

import { WebhookKind, WebhookTarget } from '../../common/types';
import { logger } from '../../common/logger';

const SEND_TIMEOUT_MS = 5_000;

export interface WebhookMessage {
  title: string;       // short headline, e.g. "Claude Code needs your input"
  body?: string;       // optional detail line (task summary, idle time)
  accentColor?: number; // Discord embed color (decimal RGB); ignored by Slack
}

export interface WebhookResult {
  ok: boolean;
  status?: number;
  error?: string;
}

// Shape the provider-specific JSON body for a message. Exported for unit tests.
export function buildPayload(kind: WebhookKind, message: WebhookMessage): Record<string, unknown> {
  const { title, body, accentColor } = message;
  if (kind === 'slack') {
    // Slack mrkdwn: *bold*. Keep it to a single text field for max webhook
    // compatibility (Incoming Webhooks + most bot-token webhook proxies).
    const text = body ? `*${title}*\n${body}` : `*${title}*`;
    return { text };
  }
  // Discord: a single embed renders the accent stripe + clean title/description.
  return {
    embeds: [
      {
        title,
        description: body || undefined,
        color: typeof accentColor === 'number' ? accentColor : undefined,
      },
    ],
  };
}

// POST the message to the target. Returns a structured result; never throws.
export async function sendWebhook(target: WebhookTarget, message: WebhookMessage): Promise<WebhookResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const res = await fetch(target.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildPayload(target.kind, message)),
      signal: controller.signal,
    });
    if (!res.ok) {
      logger.warn(`[webhook] ${target.kind} POST returned ${res.status}`);
      return { ok: false, status: res.status };
    }
    return { ok: true, status: res.status };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    logger.warn(`[webhook] ${target.kind} POST failed: ${error}`);
    return { ok: false, error };
  } finally {
    clearTimeout(timer);
  }
}
