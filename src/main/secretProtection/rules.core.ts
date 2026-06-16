// Built-in Secret Protection rules — the default "protected secrets" preset.
//
// Each rule is a .gitignore-style glob with a stable kebab-case id. The engine
// (src/main/secretProtection/engine.ts) compiles each glob to a matcher and
// tests it against the normalized file path of a read-class tool call.
//
// HOW TO ADD A NEW RULE
//   1. Append an object to CORE_SECRET_RULES below with a unique id.
//   2. Keep the glob as specific as possible to avoid false positives.
//   3. Basename globs (no '/') match the file at any directory depth; globs
//      with a '/' match anywhere as a path suffix (see engine.compileGlob).
//   4. Add coverage in src/main/secretProtection/__tests__/engine.test.ts.
//
// Source preset: central-ignore-analysis.md §9.

import { SecretRule } from '../../common/secretProtection';

export const CORE_SECRET_RULES: SecretRule[] = [
  // ── Environment & secrets ──────────────────────────────────────────────────
  { id: 'env',            glob: '.env',            source: 'core', message: 'Environment file — typically holds API keys and credentials.' },
  { id: 'env-variants',   glob: '.env.*',          source: 'core', message: 'Environment file variant (.env.local, .env.production, …).' },
  { id: 'local-env',      glob: '*.local.env',     source: 'core', message: 'Local environment file.' },

  // ── Keys & certificates ────────────────────────────────────────────────────
  { id: 'pem',            glob: '*.pem',           source: 'core', message: 'PEM key/certificate file.' },
  { id: 'key',            glob: '*.key',           source: 'core', message: 'Private key file.' },
  { id: 'p12',            glob: '*.p12',           source: 'core', message: 'PKCS#12 key bundle.' },
  { id: 'pfx',            glob: '*.pfx',           source: 'core', message: 'PFX key bundle.' },
  { id: 'id-rsa',         glob: 'id_rsa',          source: 'core', message: 'SSH private key (RSA).' },
  { id: 'id-dsa',         glob: 'id_dsa',          source: 'core', message: 'SSH private key (DSA).' },
  { id: 'id-ecdsa',       glob: 'id_ecdsa',        source: 'core', message: 'SSH private key (ECDSA).' },
  { id: 'id-ed25519',     glob: 'id_ed25519',      source: 'core', message: 'SSH private key (Ed25519).' },

  // ── SSH / cloud credentials ────────────────────────────────────────────────
  { id: 'ssh-dir',        glob: '**/.ssh/**',          source: 'core', message: 'SSH config and key directory.' },
  { id: 'aws-credentials',glob: '**/.aws/credentials', source: 'core', message: 'AWS credentials file.' },
  { id: 'azure-dir',      glob: '**/.azure/**',        source: 'core', message: 'Azure credentials directory.' },
  { id: 'gcloud-dir',     glob: '**/.config/gcloud/**',source: 'core', message: 'gcloud credentials directory.' },

  // ── Package / registry tokens ──────────────────────────────────────────────
  { id: 'npmrc',          glob: '.npmrc',          source: 'core', message: 'npm config — may contain registry auth tokens.' },
  { id: 'pypirc',         glob: '.pypirc',         source: 'core', message: 'PyPI config — may contain upload credentials.' },
  { id: 'netrc',          glob: '.netrc',          source: 'core', message: 'netrc — stores machine login credentials.' },

  // ── Generic secret stores ──────────────────────────────────────────────────
  { id: 'secrets-dir',    glob: 'secrets/**',          source: 'core', message: 'Secrets directory.' },
  { id: 'credentials-json',glob: 'credentials.json',   source: 'core', message: 'Credentials file.' },
  { id: 'service-account',glob: 'service-account*.json',source: 'core', message: 'Service-account key file.' },
  { id: 'kdbx',           glob: '*.kdbx',          source: 'core', message: 'KeePass password database.' },
];
