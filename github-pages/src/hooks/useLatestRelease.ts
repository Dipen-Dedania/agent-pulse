import { useEffect, useState } from 'react';

export const REPO_URL = 'https://github.com/Dipen-Dedania/agent-pulse';
export const RELEASES_URL = `${REPO_URL}/releases/latest`;
export const ISSUES_URL = `${REPO_URL}/issues`;
export const LICENSE_URL = `${REPO_URL}/blob/main/LICENSE`;

export type OS = 'windows' | 'mac' | 'linux';

export interface LatestRelease {
  /** e.g. "v1.1.7" — null until loaded or when the API call failed */
  version: string | null;
  /** ISO date string of the release, null when unavailable */
  publishedAt: string | null;
  /**
   * Direct download URLs per platform. Null when the asset is missing or the
   * API call failed — callers must fall back to RELEASES_URL so buttons never
   * dead-end.
   */
  assets: Record<OS, string | null>;
  /** True once the fetch settled (success or failure) */
  loaded: boolean;
}

export function detectOS(): OS {
  const platform = (
    (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform ??
    ''
  ).toLowerCase();
  if (platform.includes('mac')) return 'mac';
  if (platform.includes('linux')) return 'linux';
  return 'windows';
}

export const OS_LABELS: Record<OS, string> = {
  windows: 'Windows',
  mac: 'macOS',
  linux: 'Linux',
};

interface GitHubAsset {
  name: string;
  browser_download_url: string;
}

interface GitHubRelease {
  tag_name: string;
  published_at: string;
  assets: GitHubAsset[];
}

const EMPTY: LatestRelease = {
  version: null,
  publishedAt: null,
  assets: { windows: null, mac: null, linux: null },
  loaded: false,
};

function pickDmg(assets: GitHubAsset[]): string | null {
  const dmgs = assets.filter((a) => a.name.endsWith('.dmg'));
  if (dmgs.length === 0) return null;
  const preferred =
    dmgs.find((a) => a.name.toLowerCase().includes('universal')) ??
    dmgs.find((a) => a.name.toLowerCase().includes('arm64')) ??
    dmgs[0];
  return preferred.browser_download_url;
}

// Module-level cache so Hero and DownloadSection share a single API call
// (GitHub allows 60 unauthenticated requests per hour per IP).
let releasePromise: Promise<LatestRelease> | null = null;

function fetchLatestRelease(): Promise<LatestRelease> {
  releasePromise ??= fetch(
    'https://api.github.com/repos/Dipen-Dedania/agent-pulse/releases/latest',
  )
    .then((res) => {
      if (!res.ok) throw new Error(`GitHub API ${res.status}`);
      return res.json() as Promise<GitHubRelease>;
    })
    .then((release) => ({
      version: release.tag_name,
      publishedAt: release.published_at,
      assets: {
        windows:
          release.assets.find((a) => a.name.endsWith('.exe'))?.browser_download_url ?? null,
        mac: pickDmg(release.assets),
        linux:
          release.assets.find((a) => a.name.endsWith('.AppImage'))?.browser_download_url ?? null,
      },
      loaded: true,
    }))
    .catch(() => ({ ...EMPTY, loaded: true }));
  return releasePromise;
}

export function useLatestRelease(): LatestRelease {
  const [release, setRelease] = useState<LatestRelease>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    fetchLatestRelease().then((result) => {
      if (!cancelled) setRelease(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return release;
}
