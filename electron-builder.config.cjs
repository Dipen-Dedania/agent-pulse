// electron-builder picks this file up automatically when it lives at the
// project root, *in preference to* the "build" block in package.json. The
// only reason to externalize the config is so the `publish` array can be
// chosen at build time from an env var — see PROVIDER below. Everything
// else is the same shape we used to keep inside package.json.
//
// To build with GitHub Releases as the update feed instead of Firebase:
//   UPDATE_PROVIDER=github npm run dist:win
// Default (or any other value) is Firebase. The decision is baked into
// the packaged app's app-update.yml; clients of a given build never
// switch sources at runtime — that's deliberate. Each installer is tied
// to one feed for its lifetime.

// Single source of truth for the update feed. Edit this line to swap
// providers — that's the entire knob. No env, no separate config file.
const UPDATE_PROVIDER = 'firebase';   // 'firebase' | 'github'
const PROVIDER = UPDATE_PROVIDER.toLowerCase();

const FIREBASE_PUBLISH = {
  provider: 'generic',
  // Canonical GCS URL. The bucket must grant roles/storage.objectViewer
  // to allUsers on the /agent-pulse/releases/ prefix (or the whole bucket)
  // so electron-updater can fetch latest.yml + binaries without auth.
  url: 'https://storage.googleapis.com/bitsy-cc3f6.firebasestorage.app/agent-pulse/releases/',
};

const GITHUB_PUBLISH = {
  provider: 'github',
  owner: 'Dipen-Dedania',
  repo: 'agent-pulse',
};

const publish = PROVIDER === 'github' ? [GITHUB_PUBLISH] : [FIREBASE_PUBLISH];

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'com.agentpulse.app',
  productName: 'Agent Pulse',
  directories: {
    output: 'release',
  },
  publish,
  files: [
    'dist/**/*',
    'public/**/*',
    'package.json',
    '!**/*.map',
    '!**/__tests__/**',
    '!**/*.test.*',
  ],
  asarUnpack: [
    'public/**/*',
  ],
  win: {
    target: [
      {
        target: 'nsis',
        arch: ['x64'],
      },
    ],
    icon: 'public/assets/favicon/android-chrome-512x512.png',
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    perMachine: false,
    shortcutName: 'Agent Pulse',
  },
  mac: {
    target: [
      {
        target: 'dmg',
        arch: ['arm64', 'x64'],
      },
    ],
    icon: 'public/assets/favicon/android-chrome-512x512.png',
    category: 'public.app-category.developer-tools',
    // Agent (tray-only) app: keeps the Dock icon from ever appearing, even
    // for the instant before app.dock.hide() runs at startup.
    extendInfo: {
      LSUIElement: true,
    },
  },
  linux: {
    target: ['AppImage'],
    icon: 'public/assets/favicon/android-chrome-512x512.png',
    category: 'Development',
  },
};
