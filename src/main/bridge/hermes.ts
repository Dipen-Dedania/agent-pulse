import type { AgentState } from '../../common/types';

export const HERMES_TTL_MS = 300_000;
// A tool started (pre_tool_call) with no newer activity is a long build/test
// run, not a dead session, so it gets a longer silence allowance.
export const HERMES_TOOL_TTL_MS = 1_800_000;
const EVENTS = ['pre_llm_call', 'pre_tool_call', 'post_tool_call', 'on_session_end', 'on_human_input_request', 'on_human_input_resolved'] as const;
type EventName = typeof EVENTS[number];
export interface HermesEvent { v: 1; event: EventName; session: string; at: number; request?: string; }
interface Session {
  at: number; seen: number; ended: number; state: AgentState; inTool: boolean;
  requests: Map<string, { at: number; resolved: boolean }>;
}
const waiting = (s: Session) => [...s.requests.values()].some(r => !r.resolved);
const hex = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
export function parseHermesEvent(value: unknown, now = Date.now()): HermesEvent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const x = value as Record<string, unknown>;
  if (Object.keys(x).some(k => !['v', 'event', 'session', 'at', 'request'].includes(k))) return null;
  if (x.v !== 1 || !EVENTS.includes(x.event as EventName) || !hex(x.session) ||
      typeof x.at !== 'number' || !Number.isSafeInteger(x.at) || x.at < now - 30_000 || x.at > now + 5_000) return null;
  const human = x.event === 'on_human_input_request' || x.event === 'on_human_input_resolved';
  if (human ? !hex(x.request) : x.request !== undefined) return null;
  return x as unknown as HermesEvent;
}

/** Bounded, live-only session projection. No inferred process death or turn counts. */
export class HermesSessions {
  private sessions = new Map<string, Session>();
  expire(now = Date.now()): boolean {
    let changed = false;
    for (const [key, s] of this.sessions) {
      // A pending human request never expires: it ends on its resolution, a
      // newer turn completion, or a Pulse restart. Waits are what matter most.
      if (waiting(s)) continue;
      if (now - s.seen >= (s.inTool ? HERMES_TOOL_TTL_MS : HERMES_TTL_MS)) {
        this.sessions.delete(key); changed = true;
      }
    }
    return changed;
  }
  accept(e: HermesEvent, now = Date.now()): boolean {
    this.expire(now);
    let s = this.sessions.get(e.session);
    if (!s) {
      if (this.sessions.size >= 256) return false;
      s = { at: 0, seen: now, ended: 0, state: 'working', inTool: false, requests: new Map() };
      this.sessions.set(e.session, s);
    }
    // Resolved tombstones only need to outlive the endpoint's 30s acceptance
    // window (+5s permitted clock skew), not the lifetime of a long session.
    for (const [key, r] of s.requests) if (r.resolved && r.at < now - 35_000) s.requests.delete(key);
    if (e.request) {
      // Request correlations have their own ordering: unrelated tool events
      // must not dismiss waits. Keep resolved tombstones through the replay window.
      const prior = s.requests.get(e.request);
      if (e.at <= s.ended || (prior && (prior.resolved || e.at <= prior.at))) return true;
      if (!prior && s.requests.size >= 128) return false;
      if (e.at > s.at) {
        // Human activity also advances the session watermark: an older turn
        // completion must not idle work resumed after a resolved request.
        s.at = e.at;
        s.state = 'working';
      }
      s.requests.set(e.request, { at: e.at, resolved: e.event === 'on_human_input_resolved' });
    } else {
      if (e.at <= s.at) return true;
      s.at = e.at;
      s.inTool = e.event === 'pre_tool_call';
      if (e.event === 'on_session_end') {
        s.ended = e.at; s.state = 'idle-active';
        for (const r of s.requests.values()) if (r.at <= e.at) r.resolved = true;
      } else s.state = 'working';
    }
    s.seen = now;
    return true;
  }
  snapshot() {
    const sessions = [...this.sessions].map(([session, s]) => ({
      session, state: (waiting(s) ? 'waiting' : s.state) as AgentState,
    }));
    const state: AgentState = sessions.some(s => s.state === 'waiting') ? 'waiting'
      : sessions.some(s => s.state === 'working') ? 'working'
      : sessions.length ? 'idle-active' : 'idle';
    return { state, activeAgents: sessions.filter(s => s.state === 'working' || s.state === 'waiting').length, sessions };
  }
}
