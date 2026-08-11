// Card intake for the Claude Code MCP server (see main/mcp/server.ts).
//
// A terminal chat says "add that to my backlog"; the MCP tool posts the card
// here through the bridge. This module owns everything between the raw request
// and store.createCard: validation, project resolution (a chat's cwd → a board
// project, auto-registering the repo root the first time), and dedup so asking
// twice in one conversation doesn't produce twin cards.
//
// Kept separate from the bridge route so it's unit-testable against an
// in-memory store, and separate from ipc.ts because the renderer never calls it.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { BacklogCard, BacklogTaskType, RiskTier } from '../../common/backlog-types';
import { BacklogStore } from './store';

const TASK_TYPES: BacklogTaskType[] = ['research', 'execution', 'qa'];
const RISK_TIERS: RiskTier[] = ['green', 'amber', 'red'];

// Titles are a card's identity in the UI; long ones are a sign the model put
// the whole description in the title. Descriptions are markdown and can be
// long, but not unbounded — this is a local queue, not a document store.
export const MAX_TITLE_CHARS = 200;
export const MAX_DESCRIPTION_CHARS = 20_000;
export const MAX_CRITERIA = 20;

export interface McpCardRequest {
  title?: unknown;
  description?: unknown;
  /** The chat's cwd. Resolved to the enclosing git repo, then to a board project. */
  projectPath?: unknown;
  taskType?: unknown;
  riskTier?: unknown;
  acceptanceCriteria?: unknown;
  estimatedMinutes?: unknown;
  state?: unknown;
}

export interface NormalizedCard {
  title: string;
  description: string;
  projectPath: string;
  taskType: BacklogTaskType;
  riskTier: RiskTier;
  acceptanceCriteria: string[];
  estimatedMinutes: number | null;
  state: 'todo' | 'refinement';
}

export type McpCardResult =
  | { ok: true; duplicate: boolean; card: BacklogCard; projectName: string }
  | { ok: false; reason: string };

/**
 * Stable identity for a chat-captured card: project + normalized title. Lets a
 * repeated "add that to the backlog" in the same conversation resolve to the
 * existing card instead of a duplicate, and reuses the same
 * `source_fingerprint` column the GitLab/Linear/JIRA importers dedup on.
 */
export function chatFingerprint(projectId: string, title: string): string {
  const key = `${projectId}\u0000${title.trim().toLowerCase().replace(/\s+/g, ' ')}`;
  return `chat:${crypto.createHash('sha1').update(key).digest('hex')}`;
}

/** Validate + coerce a raw MCP payload. Pure — no fs, no store. */
export function normalizeCardRequest(req: McpCardRequest): { ok: true; value: NormalizedCard } | { ok: false; reason: string } {
  const title = typeof req?.title === 'string' ? req.title.trim().replace(/\s+/g, ' ') : '';
  if (title.length === 0) return { ok: false, reason: 'title is required' };
  if (title.length > MAX_TITLE_CHARS) {
    return { ok: false, reason: `title is too long (${title.length} chars, max ${MAX_TITLE_CHARS}) — put the detail in description` };
  }

  const projectPath = typeof req?.projectPath === 'string' ? req.projectPath.trim() : '';
  if (projectPath.length === 0) return { ok: false, reason: 'projectPath is required' };

  const description = typeof req?.description === 'string' ? req.description.slice(0, MAX_DESCRIPTION_CHARS) : '';

  const criteria = Array.isArray(req?.acceptanceCriteria)
    ? req.acceptanceCriteria
      .filter((c): c is string => typeof c === 'string')
      .map((c) => c.trim())
      .filter((c) => c.length > 0)
      .slice(0, MAX_CRITERIA)
    : [];

  const minutes = typeof req?.estimatedMinutes === 'number' && Number.isFinite(req.estimatedMinutes)
    ? Math.max(1, Math.round(req.estimatedMinutes))
    : null;

  return {
    ok: true,
    value: {
      title,
      description,
      projectPath,
      taskType: TASK_TYPES.includes(req?.taskType as BacklogTaskType) ? (req.taskType as BacklogTaskType) : 'execution',
      riskTier: RISK_TIERS.includes(req?.riskTier as RiskTier) ? (req.riskTier as RiskTier) : 'green',
      acceptanceCriteria: criteria,
      estimatedMinutes: minutes,
      // To-Do is the default: a card captured from a chat that already worked
      // through the problem is meant to be queue-ready. `refinement` stays
      // available for half-formed ideas.
      state: req?.state === 'refinement' ? 'refinement' : 'todo',
    },
  };
}

/**
 * Walk up from `start` looking for a `.git` entry (dir for a normal clone, file
 * for a worktree/submodule). Returns the repo root, or null when there is none.
 * A chat run from `repo/src/main` must land on the same project as one run from
 * `repo`, and the executor needs a git root to build worktrees from.
 */
export function findGitRoot(start: string, exists: (p: string) => boolean = fs.existsSync): string | null {
  let dir = path.resolve(start);
  // Bounded by the filesystem root: path.dirname('/') === '/' and
  // path.dirname('E:\\') === 'E:\\', so the loop terminates.
  for (;;) {
    if (exists(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export interface ProjectResolution {
  ok: boolean;
  projectId?: string;
  projectName?: string;
  registered?: boolean; // true when this call auto-added the project
  reason?: string;
}

/** Compare two paths for project-identity purposes (case-insensitive on Windows). */
function samePath(a: string, b: string): boolean {
  const norm = (p: string) => {
    const resolved = path.resolve(p).replace(/[\\/]+$/, '');
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  return norm(a) === norm(b);
}

/**
 * Map a chat's cwd to a board project. In order: an exact registered path, the
 * enclosing git root if that's registered, then a registered ancestor (covers a
 * project added as a subfolder). Failing all three, auto-register the git root
 * — that's what makes capture work in any repo without setup. A folder with no
 * git root anywhere above it is rejected: the executor can't run a card there.
 */
export function resolveProject(store: BacklogStore, projectPath: string, gitRootOf = findGitRoot): ProjectResolution {
  const projects = store.listProjects();

  const exact = projects.find((p) => samePath(p.path, projectPath));
  if (exact) return { ok: true, projectId: exact.id, projectName: exact.name, registered: false };

  const root = gitRootOf(projectPath);
  if (root) {
    const atRoot = projects.find((p) => samePath(p.path, root));
    if (atRoot) return { ok: true, projectId: atRoot.id, projectName: atRoot.name, registered: false };
  }

  // Nearest registered ancestor (longest path wins) — e.g. the board holds
  // `E:/repos/mono` and the chat is in `E:/repos/mono/packages/web`.
  const ancestors = projects
    .filter((p) => {
      const rel = path.relative(path.resolve(p.path), path.resolve(projectPath));
      return rel.length > 0 && !rel.startsWith('..') && !path.isAbsolute(rel);
    })
    .sort((a, b) => b.path.length - a.path.length);
  if (ancestors[0]) return { ok: true, projectId: ancestors[0].id, projectName: ancestors[0].name, registered: false };

  if (!root) {
    return { ok: false, reason: `${projectPath} is not inside a git repository — add the project in Agent Pulse first` };
  }
  const created = store.addProject(root);
  return { ok: true, projectId: created.id, projectName: created.name, registered: true };
}

/**
 * Create (or resolve to an existing) card from an MCP request. Never throws —
 * every failure comes back as `{ ok: false, reason }` so the MCP tool can hand
 * the model a sentence it can act on.
 */
export function intakeCard(store: BacklogStore, req: McpCardRequest): McpCardResult {
  const normalized = normalizeCardRequest(req);
  if (!normalized.ok) return { ok: false, reason: normalized.reason };
  const card = normalized.value;

  const project = resolveProject(store, card.projectPath);
  if (!project.ok || !project.projectId) return { ok: false, reason: project.reason ?? 'could not resolve a project' };

  const fingerprint = chatFingerprint(project.projectId, card.title);
  const existing = store.listCards().find((c) => c.sourceFingerprint === fingerprint);
  if (existing) {
    return { ok: true, duplicate: true, card: existing, projectName: project.projectName ?? '' };
  }

  const created = store.createCard({
    title: card.title,
    description: card.description,
    projectId: project.projectId,
    state: card.state,
    taskType: card.taskType,
    riskTier: card.riskTier,
    estimatedMinutes: card.estimatedMinutes,
    acceptanceCriteria: card.acceptanceCriteria,
    sourceFingerprint: fingerprint,
  });
  return { ok: true, duplicate: false, card: created, projectName: project.projectName ?? '' };
}
