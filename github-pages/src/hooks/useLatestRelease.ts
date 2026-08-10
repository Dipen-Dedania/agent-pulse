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

// ---------------------------------------------------------------------------
// Release list — powers the "What's new" changelog section
// ---------------------------------------------------------------------------

export interface ReleaseNote {
  /** e.g. "v1.1.7" */
  version: string;
  /** Human release name; falls back to the tag when GitHub has none */
  name: string;
  /** ISO date string */
  publishedAt: string;
  /** Raw markdown body of the release notes ("" when empty) */
  body: string;
  /** Web URL to the release on GitHub */
  url: string;
}

export interface ReleaseList {
  releases: ReleaseNote[];
  /** True once the fetch settled (success or failure) */
  loaded: boolean;
}

interface GitHubReleaseListItem extends GitHubRelease {
  name: string | null;
  html_url: string;
  body: string | null;
  draft: boolean;
  prerelease: boolean;
}

const EMPTY_LIST: ReleaseList = { releases: [], loaded: false };

// Separate module-level cache from the "latest" call above. This is the only
// place the release list is fetched, so the changelog costs one request total.
let releaseListPromise: Promise<ReleaseList> | null = null;

function fetchReleaseList(): Promise<ReleaseList> {
  releaseListPromise ??= fetch(
    'https://api.github.com/repos/Dipen-Dedania/agent-pulse/releases?per_page=5',
  )
    .then((res) => {
      if (!res.ok) throw new Error(`GitHub API ${res.status}`);
      return res.json() as Promise<GitHubReleaseListItem[]>;
    })
    .then((list) => ({
      releases: list
        .filter((r) => !r.draft)
        .map((r) => ({
          version: r.tag_name,
          name: r.name || r.tag_name,
          publishedAt: r.published_at,
          body: r.body ?? '',
          url: r.html_url,
        })),
      loaded: true,
    }))
    .catch(() => ({ ...EMPTY_LIST, loaded: true }));
  return releaseListPromise;
}

export function useReleases(): ReleaseList {
  const [list, setList] = useState<ReleaseList>(EMPTY_LIST);

  useEffect(() => {
    let cancelled = false;
    fetchReleaseList().then((result) => {
      if (!cancelled) setList(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return list;
}

// ---------------------------------------------------------------------------
// Repo stats — powers the live GitHub star count in StatsBar
// ---------------------------------------------------------------------------

export interface RepoStats {
  stars: number | null;
  forks: number | null;
  /** True once the fetch settled (success or failure) */
  loaded: boolean;
}

interface GitHubRepo {
  stargazers_count: number;
  forks_count: number;
}

const EMPTY_STATS: RepoStats = { stars: null, forks: null, loaded: false };

let repoStatsPromise: Promise<RepoStats> | null = null;

function fetchRepoStats(): Promise<RepoStats> {
  repoStatsPromise ??= fetch('https://api.github.com/repos/Dipen-Dedania/agent-pulse')
    .then((res) => {
      if (!res.ok) throw new Error(`GitHub API ${res.status}`);
      return res.json() as Promise<GitHubRepo>;
    })
    .then((repo) => ({
      stars: repo.stargazers_count,
      forks: repo.forks_count,
      loaded: true,
    }))
    .catch(() => ({ ...EMPTY_STATS, loaded: true }));
  return repoStatsPromise;
}

export function useRepoStats(): RepoStats {
  const [stats, setStats] = useState<RepoStats>(EMPTY_STATS);

  useEffect(() => {
    let cancelled = false;
    fetchRepoStats().then((result) => {
      if (!cancelled) setStats(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return stats;
}

// ---------------------------------------------------------------------------
// Contributors — powers the community wall (avatars come from GitHub, so no
// new third-party host is introduced beyond the GitHub API the site already
// calls). Bots are filtered out.
// ---------------------------------------------------------------------------

export interface Contributor {
  login: string;
  avatarUrl: string;
  profileUrl: string;
}

export interface ContributorList {
  contributors: Contributor[];
  loaded: boolean;
}

interface GitHubContributor {
  login: string;
  avatar_url: string;
  html_url: string;
  type: string;
}

const EMPTY_CONTRIBUTORS: ContributorList = { contributors: [], loaded: false };

let contributorsPromise: Promise<ContributorList> | null = null;

function fetchContributors(): Promise<ContributorList> {
  contributorsPromise ??= fetch(
    'https://api.github.com/repos/Dipen-Dedania/agent-pulse/contributors?per_page=30',
  )
    .then((res) => {
      if (!res.ok) throw new Error(`GitHub API ${res.status}`);
      return res.json() as Promise<GitHubContributor[]>;
    })
    .then((list) => ({
      contributors: list
        .filter((c) => c.type !== 'Bot' && !c.login.includes('[bot]'))
        .map((c) => ({ login: c.login, avatarUrl: c.avatar_url, profileUrl: c.html_url })),
      loaded: true,
    }))
    .catch(() => ({ ...EMPTY_CONTRIBUTORS, loaded: true }));
  return contributorsPromise;
}

export function useContributors(): ContributorList {
  const [list, setList] = useState<ContributorList>(EMPTY_CONTRIBUTORS);

  useEffect(() => {
    let cancelled = false;
    fetchContributors().then((result) => {
      if (!cancelled) setList(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return list;
}
