// Issue population orchestrator (Phase 3). Owns linking, scanning, and the
// Review & Import lifecycle for every source (GitLab, Linear, JIRA), decoupled
// from the execution engine. A scan is a read-only scout run (see scout-core.ts /
// gitlab-scout.ts / linear-scout.ts / jira-scout.ts) that refreshes the cache; cards
// are created only on explicit import. Scans spend real Claude window budget the
// engine's usage latch can't see, so scanning gates on the same usage snapshot
// the engine uses (item F). See backlog-phase3-gitlab-population-plan.md.

import { logger } from '../../common/logger';
import {
  BacklogPopulationConfig,
  IssueCandidate,
  IssueFilter,
  IssueSourceKind,
  IssuePopulationState,
} from '../../common/backlog-types';
import { BacklogStore } from './store';
import { parseGitRemote, readOriginRemote } from './gitlab-remote';
import { fetchIssues as gitlabFetchIssues, resolveProjectId } from './gitlab-scout';
import { fetchIssues as linearFetchIssues, listProjects as listLinearProjectsScout, listTeams, LinearProject, LinearTeam } from './linear-scout';
import { fetchIssues as jiraFetchIssues, listProjects as listJiraProjectsScout, listSites, JiraProject, JiraSite } from './jira-scout';
import { ScoutConnector } from './scout-core';

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
  /** Reuse the board's `backlog:changed` broadcaster — hydrate carries population state. */
  broadcast: () => void;
}

/** GitLab dedup key. Uses the NUMERIC project id (survives renames). */
export function fingerprintFor(gitlabProjectId: number, iid: number): string {
  return `gitlab:${gitlabProjectId}:${iid}`;
}

/** Linear dedup key. teamId + the workspace-unique issue identifier. */
export function linearFingerprintFor(teamId: string, identifier: string): string {
  return `linear:${teamId}:${identifier}`;
}

/** JIRA dedup key. cloudId + the STABLE numeric issue id (survives key changes
 *  when an issue moves project — the human key can change, the id cannot). */
export function jiraFingerprintFor(cloudId: string, issueId: string): string {
  return `jira:${cloudId}:${issueId}`;
}

// Normalized candidate shape both providers reduce to before upsert.
interface NormalizedIssue {
  fingerprint: string;
  ref: string;
  title: string;
  description: string;
  webUrl: string;
  labels: string[];
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
  getState(): IssuePopulationState {
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

  /** Link a project to its GitLab project via the repo's `origin` remote. */
  async linkGitlab(projectId: string): Promise<{ ok: boolean; reason?: string; projectPath?: string; host?: string; id?: number; connector?: ScoutConnector }> {
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
    this.store.setSourceLink(projectId, {
      kind: 'gitlab',
      ref: String(res.id),
      host: remote.host,
      slug: remote.projectPath,
      name: remote.projectPath,
    });
    // Seed the filter to the configured default on first link.
    this.store.setIssueFilter(projectId, { mode: this.config().defaultFilterMode, labels: [] });
    this.deps.broadcast();
    return { ok: true, projectPath: remote.projectPath, host: remote.host, id: res.id, connector: res.connector };
  }

  /** List the workspace's Linear teams for the link-time picker (no state change). */
  async listLinearTeams(): Promise<{ ok: boolean; teams: LinearTeam[]; reason?: string; connector?: ScoutConnector }> {
    const res = await listTeams(this.config().scoutModel);
    this.setConnector(res.connector);
    if (!res.ok) {
      this.lastReason = res.reason ?? 'could not list Linear teams';
      this.deps.broadcast();
      return { ok: false, teams: [], reason: this.lastReason, connector: res.connector };
    }
    return { ok: true, teams: res.teams, connector: res.connector };
  }

  /** List a Linear team's projects for the optional link-time narrowing step. */
  async listLinearProjects(teamId: string): Promise<{ ok: boolean; projects: LinearProject[]; reason?: string; connector?: ScoutConnector }> {
    if (typeof teamId !== 'string' || teamId.trim().length === 0) {
      return { ok: false, projects: [], reason: 'a Linear team is required' };
    }
    const res = await listLinearProjectsScout(teamId, this.config().scoutModel);
    this.setConnector(res.connector);
    if (!res.ok) {
      this.lastReason = res.reason ?? 'could not list Linear projects';
      this.deps.broadcast();
      return { ok: false, projects: [], reason: this.lastReason, connector: res.connector };
    }
    return { ok: true, projects: res.projects, connector: res.connector };
  }

  /** Link a project to a chosen Linear team, optionally scoped to one project. */
  linkLinear(
    projectId: string,
    team: { teamId: string; teamKey: string; teamName: string },
    project?: { projectId: string; projectName: string } | null,
  ): { ok: boolean; reason?: string } {
    const row = this.store.listProjects().find((p) => p.id === projectId);
    if (!row) return { ok: false, reason: 'project not found' };
    if (typeof team?.teamId !== 'string' || team.teamId.trim().length === 0) {
      return { ok: false, reason: 'a Linear team is required' };
    }
    const scopeRef = typeof project?.projectId === 'string' && project.projectId.trim().length > 0 ? project.projectId : undefined;
    const scopeName = scopeRef ? (project?.projectName || scopeRef) : undefined;
    this.store.setSourceLink(projectId, {
      kind: 'linear',
      ref: team.teamId,
      host: null,
      slug: team.teamKey || team.teamId,
      name: team.teamName || team.teamKey || team.teamId,
      ...(scopeRef ? { scopeRef, scopeName } : {}),
    });
    this.store.setIssueFilter(projectId, { mode: this.config().defaultFilterMode, labels: [] });
    this.deps.broadcast();
    return { ok: true };
  }

  /** List the user's accessible Atlassian sites for the JIRA link Step-1 picker. */
  async listJiraSites(): Promise<{ ok: boolean; sites: JiraSite[]; reason?: string; connector?: ScoutConnector }> {
    logger.info(`[Backlog/jira] listJiraSites: launching scout (model ${this.config().scoutModel})…`);
    const res = await listSites();
    this.setConnector(res.connector);
    if (!res.ok) {
      this.lastReason = res.reason ?? 'could not list Atlassian sites';
      this.deps.broadcast();
      return { ok: false, sites: [], reason: this.lastReason, connector: res.connector };
    }
    return { ok: true, sites: res.sites, connector: res.connector };
  }

  /** List a site's Jira projects for the JIRA link Step-2 picker. */
  async listJiraProjects(cloudId: string): Promise<{ ok: boolean; projects: JiraProject[]; reason?: string; connector?: ScoutConnector }> {
    if (typeof cloudId !== 'string' || cloudId.trim().length === 0) {
      return { ok: false, projects: [], reason: 'an Atlassian site is required' };
    }
    logger.info(`[Backlog/jira] listJiraProjects: launching scout for cloudId ${cloudId}…`);
    const res = await listJiraProjectsScout(cloudId);
    this.setConnector(res.connector);
    if (!res.ok) {
      this.lastReason = res.reason ?? 'could not list Jira projects';
      this.deps.broadcast();
      return { ok: false, projects: [], reason: this.lastReason, connector: res.connector };
    }
    return { ok: true, projects: res.projects, connector: res.connector };
  }

  /** Link a project to a chosen JIRA site + project. Both are mandatory: the
   *  project key (stored as scopeRef) scopes every scan's JQL. */
  linkJira(
    projectId: string,
    site: { cloudId: string; siteUrl: string; siteName: string },
    project: { projectKey: string; projectName: string },
  ): { ok: boolean; reason?: string } {
    const row = this.store.listProjects().find((p) => p.id === projectId);
    if (!row) return { ok: false, reason: 'project not found' };
    if (typeof site?.cloudId !== 'string' || site.cloudId.trim().length === 0) {
      return { ok: false, reason: 'an Atlassian site is required' };
    }
    if (typeof project?.projectKey !== 'string' || project.projectKey.trim().length === 0) {
      return { ok: false, reason: 'a Jira project is required' };
    }
    this.store.setSourceLink(projectId, {
      kind: 'jira',
      ref: site.cloudId,
      host: site.siteUrl,
      slug: project.projectKey,
      name: project.projectName || project.projectKey,
      scopeRef: project.projectKey,          // MANDATORY for JIRA — scopes the JQL.
      scopeName: project.projectName || project.projectKey,
    });
    this.store.setIssueFilter(projectId, { mode: this.config().defaultFilterMode, labels: [] });
    this.deps.broadcast();
    logger.info(`[Backlog/jira] linked project ${projectId} → JIRA ${project.projectKey} on ${site.siteUrl}`);
    return { ok: true };
  }

  unlinkProject(projectId: string): { ok: boolean } {
    this.store.clearSourceLink(projectId);
    this.deps.broadcast();
    return { ok: true };
  }

  setIssueFilter(projectId: string, filter: IssueFilter): { ok: boolean } {
    this.store.setIssueFilter(projectId, filter);
    this.deps.broadcast();
    return { ok: true };
  }

  // ── Scanning ──────────────────────────────────────────────────────────────

  /** Fetch + normalize a linked project's issues via its source's scout. */
  private async fetchNormalized(
    source: NonNullable<ReturnType<BacklogStore['listProjects']>[number]['source']>,
    filter: IssueFilter,
    model: string,
  ): Promise<{ ok: boolean; connector: ScoutConnector; issues: NormalizedIssue[]; reason?: string }> {
    if (source.kind === 'linear') {
      const r = await linearFetchIssues(source.ref, filter, model, source.scopeRef);
      const issues = r.issues.map((i) => ({
        fingerprint: linearFingerprintFor(source.ref, i.identifier),
        ref: i.identifier,
        title: i.title,
        description: i.description,
        webUrl: i.webUrl,
        labels: i.labels,
      }));
      return { ok: r.ok, connector: r.connector, issues, reason: r.reason };
    }
    if (source.kind === 'jira') {
      // JIRA needs a project key (source.scopeRef) — the shared model treats scope
      // as optional, but the JQL scan can't run without it. Fail with a clear reason.
      if (!source.scopeRef) {
        return { ok: false, connector: this.connector === 'unknown' ? 'connected' : this.connector, issues: [], reason: 'JIRA link is missing a project key' };
      }
      const r = await jiraFetchIssues(source.ref /* cloudId */, source.scopeRef /* projectKey */, filter);
      const issues = r.issues.map((i) => ({
        // Fingerprint on the stable numeric id; display the human key (decision #3).
        fingerprint: jiraFingerprintFor(source.ref, i.issueId),
        ref: i.issueKey,
        title: i.title,
        description: i.description,
        webUrl: i.webUrl,
        labels: i.labels,
      }));
      return { ok: r.ok, connector: r.connector, issues, reason: r.reason };
    }
    // GitLab: the numeric project id is stored as text.
    const numericId = Number(source.ref);
    const r = await gitlabFetchIssues(numericId, filter, model);
    const issues = r.issues.map((i) => ({
      fingerprint: fingerprintFor(numericId, i.iid),
      ref: String(i.iid),
      title: i.title,
      description: i.description,
      webUrl: i.webUrl,
      labels: i.labels,
    }));
    return { ok: r.ok, connector: r.connector, issues, reason: r.reason };
  }

  async refreshProject(projectId: string): Promise<{ ok: boolean; candidates: number; connector: 'connected' | 'needs-auth' | 'unknown'; reason?: string }> {
    const project = this.store.listProjects().find((p) => p.id === projectId);
    if (!project) return { ok: false, candidates: 0, connector: this.connector, reason: 'project not found' };
    if (project.source == null) return { ok: false, candidates: 0, connector: this.connector, reason: 'project is not linked to an issue source' };

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
      const res = await this.fetchNormalized(project.source, project.issueFilter, this.config().scoutModel);
      this.setConnector(res.connector);
      this.lastScanAt = Date.now();
      if (!res.ok) {
        this.lastReason = res.reason ?? 'scan failed';
        logger.info(`[Backlog/population] scan of ${project.name} failed: ${this.lastReason}`);
        return { ok: false, candidates: 0, connector: res.connector, reason: res.reason };
      }
      const kept: string[] = [];
      const toUpsert: IssueCandidate[] = [];
      const now = Date.now();
      const sourceKind: IssueSourceKind = project.source.kind;
      for (const issue of res.issues) {
        // Suppress issues already imported (any card state) or dismissed (D5).
        if (this.store.hasCardForFingerprint(issue.fingerprint) || this.store.isDismissed(issue.fingerprint)) continue;
        kept.push(issue.fingerprint);
        toUpsert.push({
          fingerprint: issue.fingerprint,
          projectId,
          sourceKind,
          ref: issue.ref,
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
    const linked = this.store.listProjects().filter((p) => p.source != null);
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
      .filter((c): c is IssueCandidate => !!c)
      .map((c) => ({ fingerprint: c.fingerprint, projectId: c.projectId, sourceKind: c.sourceKind }));
    this.store.dismiss(rows);
    this.store.deleteCandidates(fingerprints);
    if (fingerprints.length > 0) this.deps.broadcast();
    return { ok: true, dismissed: rows.length };
  }
}
