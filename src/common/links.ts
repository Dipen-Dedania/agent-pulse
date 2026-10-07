// Public URLs for the project, shared by main (updater, star nudge) and the
// renderer. Owner/repo mirror GITHUB_PUBLISH in electron-builder.config.cjs.
export const REPO_URL = 'https://github.com/Dipen-Dedania/agent-pulse';

// Human-facing release page. The release workflow attaches every installer
// (exe, dmg, AppImage) to the GitHub Release for the tag.
export const RELEASES_PAGE = `${REPO_URL}/releases`;
