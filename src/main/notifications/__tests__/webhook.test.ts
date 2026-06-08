import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildPayload, sendWebhook } from '../webhook';
import { WebhookTarget } from '../../../common/types';

const discord: WebhookTarget = { id: 'd', kind: 'discord', url: 'https://discord.test/wh', enabled: true };
const slack: WebhookTarget = { id: 's', kind: 'slack', url: 'https://slack.test/wh', enabled: true };

describe('buildPayload', () => {
  it('shapes a Discord embed with title/description/color', () => {
    const p = buildPayload('discord', { title: 'Claude Code needs you', body: 'Fix login · Idle 30s', accentColor: 0xf97316 });
    expect(p).toEqual({
      embeds: [{ title: 'Claude Code needs you', description: 'Fix login · Idle 30s', color: 0xf97316 }],
    });
  });

  it('omits the Discord description when there is no body', () => {
    const p = buildPayload('discord', { title: 'Heads up' }) as any;
    expect(p.embeds[0].description).toBeUndefined();
  });

  it('shapes a Slack text field with bold title and body', () => {
    const p = buildPayload('slack', { title: 'Claude Code needs you', body: 'Idle 30s' });
    expect(p).toEqual({ text: '*Claude Code needs you*\nIdle 30s' });
  });

  it('shapes a Slack text field without a body', () => {
    const p = buildPayload('slack', { title: 'Heads up' });
    expect(p).toEqual({ text: '*Heads up*' });
  });
});

describe('sendWebhook', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it('POSTs JSON and returns ok on a 2xx', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetchMock);

    const res = await sendWebhook(slack, { title: 'hi' });

    expect(res).toEqual({ ok: true, status: 204 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(slack.url);
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ text: '*hi*' });
  });

  it('returns ok:false with the status on a non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    const res = await sendWebhook(discord, { title: 'hi' });
    expect(res).toEqual({ ok: false, status: 404 });
  });

  it('returns ok:false with an error on a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));
    const res = await sendWebhook(discord, { title: 'hi' });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('boom');
  });
});
