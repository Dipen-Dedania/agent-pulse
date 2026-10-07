// Codex counterpart of claude-settings.ts: what a flag-less `codex exec` would
// run with. Codex has one user-level config (`$CODEX_HOME/config.toml`, default
// ~/.codex) with a top-level `model = "…"` key; there is no per-project
// settings file to consult. Best-effort pre-fill for the card editor — profiles
// and env overrides are out of scope.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { isSafeModelId } from '../../common/backlog-types';
import { ProjectDefaultModel } from './claude-settings';

export function codexHome(): string {
  const fromEnv = process.env.CODEX_HOME?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : path.join(os.homedir(), '.codex');
}

/**
 * Pull the root-table `model` value out of config.toml text. Only lines BEFORE
 * the first `[table]` header belong to the root table; a `model =` inside
 * `[profiles.x]` must not win. Pure — exported for tests.
 */
export function parseCodexDefaultModel(toml: string): string | null {
  for (const raw of toml.split(/\r?\n/)) {
    const line = raw.replace(/^﻿/, '').trim();
    if (line.startsWith('[')) break;
    const m = /^model\s*=\s*(?:"([^"]*)"|'([^']*)')\s*(?:#.*)?$/.exec(line);
    if (m) {
      const value = (m[1] ?? m[2] ?? '').trim();
      return value && isSafeModelId(value) ? value : null;
    }
  }
  return null;
}

export function resolveCodexDefaultModel(): ProjectDefaultModel {
  try {
    const model = parseCodexDefaultModel(fs.readFileSync(path.join(codexHome(), 'config.toml'), 'utf8'));
    return model ? { model, source: 'user' } : { model: null, source: null };
  } catch {
    return { model: null, source: null };
  }
}
