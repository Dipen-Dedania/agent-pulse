// GitLab population orchestrator (Phase 3). Owns linking, scanning, and the
// Review & Import lifecycle, decoupled from the execution engine. A scan is a
// read-only scout run (see gitlab-scout.ts) that refreshes the candidate cache;
// cards are created only on explicit import. Scans spend real Claude window
// budget the engine's usage latch can't see, so scanning gates on the same
// usage snapshot the engine uses (item F). See backlog-phase3-gitlab-population-plan.md.

import { logger } from '../../common/logger';
import { BacklogPopulationConfig, GitlabCandidate, GitlabIssueFilter, GitlabPopulationState } from '../../common/backlog-types';
import { BacklogStore } from './store';
import { parseGitRemote, readOriginRemote } from './gitlab-remote';
import { fetchIssues, resolveProjectId, ScoutConnector } from './gitlab-scout';

// Skip a scan when the 5-hour window is at/above this utilization — a scout
// would just compete with (or precede) execution by spending the last budget.
// Mirrors the engine's default proactive gate.
const USAGE_GATE_PERCENT = 95;
const MIN_REFRESH_INTERVAL_MS = 15 * 60_000;

export interface PopulationDeps {
  store: BacklogStore;
  getConfig: () => BacklogPopulationConfig;
  /** Same snapshot the engine uses; null = unknown. utilization is 0–100. */
  getUsage?: () => { utilization: number; resetsAt: number } | null;
  /** Reuse the board's `backlog:changed` broadcaster — hydrate carries gitlab state. */
  broadcast: () => void;
}

/** Stable dedup key. Uses the GitLab NUMERIC project id (survives renames). */
export function fingerprintFor(gitlabProjectId: number, iid: number): string {
  return `gitlab:${gitlabProjectId}:${iid}`;
}

export class PopulationScheduler {
  private readonly store: BacklogStore;
  private readonly deps: PopulationDeps;
  private scanning = false;
  private connector: 'connected' | 'needs-auth' | 'unknown' = 'unknown';
  private lastScanAt: number | null = null;
  private lastReason: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  private stopped = true;

  constructor(deps: PopulationDeps) {
    this.store = deps.store;
    this.deps = deps;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.reschedule();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  applyConfig(): void {
    if (!this.stopped) this.reschedule();
  }

  /** Board hydrate slice — candidates + connector/scan hints. */
  getState(): GitlabPopulationState {
    return {
      candidates: this.store.listCandidates(),
      connector: this.connector,
      scanning: this.scanning,
      lastScanAt: this.lastScanAt,
      lastReason: this.lastReason,
    };
  }

  private config(): BacklogPopulationConfig {
    return this.deps.getConfig();
  }

  private setConnector(c: ScoutConnector): void {
    this.connector = c;
  }

  private reschedule(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    const cfg = this.config();
    if (this.stopped || !cfg.enabled || !cfg.backgroundRefresh) return;
    const ms = Math.max(MIN_REFRESH_INTERVAL_MS, cfg.refreshIntervalMinutes * 60_000);
    this.timer = setInterval(() => { void this.refreshAll(); }, ms);
    this.timer.unref?.();
  }

  // ── Linking ─────────────────────────────────────────────────────────────

  async linkProject(projectId: string): Promise<{ ok: boolean; reason?: string; projectPath?: string; host?: string; id?: number; connector?: ScoutConnector }> {
    const project = this.store.listProjects().find((p) => p.id === projectId);
    if (!project) return { ok: false, reason: 'project not found' };
    const url = await readOriginRemote(project.path);
    if (!url) return { ok: false, reason: 'no `origin` git remote found for this repo' };
    const remote = parseGitRemote(url);
    if (!remote) return { ok: false, reason: `could not parse a GitLab project from the origin remote (${url})` };
    const res = await resolveProjectId(remote.host, remote.projectPath, this.config().scoutModel);
    this.setConnector(res.connector);
    if (res.id == null) {
      this.lastReason = res.reason ?? 'could not resolve the GitLab project id';
      this.deps.broadcast();
      return { ok: false, reason: this.lastReason, connector: res.connector };
    }
    this.store.setGitlabLink(projectId, { id: res.id, host: remote.host, projectPath: remote.projectPath });
    // Seed the filter to the configured default on first link.
    this.store.setIssueFilter(projectId, { mode: this.config().defaultFilterMode, labels: [] });
    this.deps.broadcast();
    return { ok: true, projectPath: remote.projectPath, host: remote.host, id: res.id, connector: res.connector };
  }

  unlinkProject(projectId: string): { ok: boolean } {
    this.store.clearGitlabLink(projectId);
    this.deps.broadcast();
    return { ok: true };
  }

  setIssueFilter(projectId: string, filter: GitlabIssueFilter): { ok: boolean } {
    this.store.setIssueFilter(projectId, filter);
    this.deps.broadcast();
    return { ok: true };
  }

  // ── Scanning ──────────────────────────────────────────────────────────────

  async refreshProject(projectId: string): Promise<{ ok: boolean; candidates: number; connector: 'connected' | 'needs-auth' | 'unknown'; reason?: string }> {
    const project = this.store.listProjects().find((p) => p.id === projectId);
    if (!project) return { ok: false, candidates: 0, connector: this.connector, reason: 'project not found' };
    if (project.gitlabProjectId == null) return { ok: false, candidates: 0, connector: this.connector, reason: 'project is not linked to GitLab' };

    // Usage gate (item F): a scout spends real window budget the engine can't see.
    const usage = this.deps.getUsage?.();
    if (usage && usage.utilization >= USAGE_GATE_PERCENT) {
      this.lastReason = 'skipped — Claude usage window is nearly exhausted';
      this.deps.broadcast();
      return { ok: false, candidates: 0, connector: this.connector, reason: this.lastReason };
    }

    this.scanning = true;
    this.deps.broadcast();
    try {
      const res = await fetchIssues(project.gitlabProjectId, project.issueFilter, this.config().scoutModel);
      this.setConnector(res.connector);
      this.lastScanAt = Date.now();
      if (!res.ok) {
        this.lastReason = res.reason ?? 'scan failed';
        logger.info(`[Backlog/population] scan of ${project.name} failed: ${this.lastReason}`);
        return { ok: false, candidates: 0, connector: res.connector, reason: res.reason };
      }
      const kept: string[] = [];
      const toUpsert: GitlabCandidate[] = [];
      const now = Date.now();
      for (const issue of res.issues) {
        const fp = fingerprintFor(project.gitlabProjectId, issue.iid);
        // Suppress issues already imported (any card state) or dismissed (D5).
        if (this.store.hasCardForFingerprint(fp) || this.store.isDismissed(fp)) continue;
        kept.push(fp);
        toUpsert.push({
          fingerprint: fp,
          projectId,
          iid: issue.iid,
          title: issue.title,
          description: issue.description,
          webUrl: issue.webUrl,
          labels: issue.labels,
          fetchedAt: now,
        });
      }
      this.store.upsertCandidates(toUpsert);
      this.store.pruneCandidatesNotIn(projectId, kept);
      this.store.setLastScan(projectId, this.lastScanAt);
      this.lastReason = null;
      return { ok: true, candidates: toUpsert.length, connector: 'connected' };
    } finally {
      this.scanning = false;
      this.deps.broadcast();
    }
  }

  async refreshAll(): Promise<{ ok: boolean; candidates: number }> {
    const linked = this.store.listProjects().filter((p) => p.gitlabProjectId != null);
    let total = 0;
    for (const p of linked) {
      const r = await this.refreshProject(p.id);
      if (r.ok) total += r.candidates;
    }
    return { ok: true, candidates: total };
  }

  // ── Review & Import ─────────────────────────────────────────────────────

  importCandidates(fingerprints: string[]): { ok: boolean; imported: number } {
    const byFp = new Map(this.store.listCandidates().map((c) => [c.fingerprint, c]));
    let imported = 0;
    for (const fp of fingerprints) {
      const c = byFp.get(fp);
      if (!c) continue;
      this.store.createCard({
        title: c.title,
        description: c.description,
        projectId: c.projectId,
        state: 'refinement',
        sourceUrl: c.webUrl,
        sourceFingerprint: c.fingerprint,
      });
      imported++;
    }
    this.store.deleteCandidates(fingerprints);
    if (imported > 0 || fingerprints.length > 0) this.deps.broadcast();
    return { ok: true, imported };
  }

  dismissCandidates(fingerprints: string[]): { ok: boolean; dismissed: number } {
    const byFp = new Map(this.store.listCandidates().map((c) => [c.fingerprint, c]));
    const rows = fingerprints
      .map((fp) => byFp.get(fp))
      .filter((c): c is GitlabCandidate => !!c)
      .map((c) => ({ fingerprint: c.fingerprint, projectId: c.projectId }));
    this.store.dismiss(rows);
    this.store.deleteCandidates(fingerprints);
    if (fingerprints.length > 0) this.deps.broadcast();
    return { ok: true, dismissed: rows.length };
  }
}
