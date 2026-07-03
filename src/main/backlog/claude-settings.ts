import fs from 'fs';
import os from 'os';
import path from 'path';
import { isSafeModelId } from '../../common/backlog-types';

// Where a project's default model was found — shown in the card editor so the
// user knows what "Project default" resolves to.
export type ModelSource = 'project-local' | 'project' | 'user';

export interface ProjectDefaultModel {
  model: string | null;
  source: ModelSource | null;
}

/**
 * Resolve the default model a `claude -p` run launched in `projectPath` would
 * use, reading the same settings files the CLI does in precedence order:
 * project .claude/settings.local.json → project .claude/settings.json →
 * user ~/.claude/settings.json. Returns null when none pins a model — the
 * CLI's own default applies then. Best-effort pre-fill for the card editor:
 * enterprise managed settings and env overrides are out of scope.
 */
export function resolveProjectDefaultModel(projectPath: string): ProjectDefaultModel {
  const candidates: { file: string; source: ModelSource }[] = [
    { file: path.join(projectPath, '.claude', 'settings.local.json'), source: 'project-local' },
    { file: path.join(projectPath, '.claude', 'settings.json'), source: 'project' },
    { file: path.join(os.homedir(), '.claude', 'settings.json'), source: 'user' },
  ];
  for (const { file, source } of candidates) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      const model = typeof parsed?.model === 'string' ? parsed.model.trim() : '';
      if (model && isSafeModelId(model)) return { model, source };
    } catch {
      // missing or malformed settings file — fall through to the next source
    }
  }
  return { model: null, source: null };
}
