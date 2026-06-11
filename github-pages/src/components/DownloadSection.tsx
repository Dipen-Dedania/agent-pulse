/**
 * DownloadSection — §4.12 + §5
 * Three platform cards (Windows / macOS / Linux) with live version data from
 * the GitHub API. The detected OS card gets a filled blue button and a
 * "RECOMMENDED FOR YOU" badge; the others get outline buttons.
 * Every button falls back to RELEASES_URL so it never dead-ends.
 */
import { useLatestRelease, detectOS, RELEASES_URL, type OS } from '../hooks/useLatestRelease';

// ---------------------------------------------------------------------------
// Platform inline SVG icons — single-color navy, 28px
// ---------------------------------------------------------------------------

function WindowsIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      {/* Windows 4-pane grid */}
      <path d="M3 3.5 11.5 2.4v9.1H3V3.5zm0 17 8.5 1.1v-9H3v7.9zM12.5 2.25 21 1v10.5h-8.5V2.25zM12.5 21.75 21 23v-10.5h-8.5v9.25z" />
    </svg>
  );
}

function MacIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      {/* Apple silhouette — simplified abstract shape */}
      <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.7 9.05 7.4c1.39.07 2.36.74 3.18.75.98 0 2.83-.93 4.78-.79 1.24.1 3.35.68 4.3 2.65-3.78 2.27-3.16 7.29.57 8.81-.63 1.52-1.32 3.02-2.83 4.46zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
    </svg>
  );
}

function LinuxIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      {/* Abstract penguin-like shape — circle head + body */}
      <circle cx="12" cy="6" r="3.5" />
      <path d="M8 11.5c0-2.2 1.8-4 4-4s4 1.8 4 4v4c0 1.1-.9 2-2 2H10c-1.1 0-2-.9-2-2v-4z" />
      <circle cx="9" cy="19.5" r="1.25" />
      <circle cx="15" cy="19.5" r="1.25" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Platform card config
// ---------------------------------------------------------------------------

interface PlatformCard {
  os: OS;
  label: string;
  buttonText: string;
  caption: string;
  Icon: () => React.ReactElement;
}

const platforms: PlatformCard[] = [
  {
    os: 'windows',
    label: 'Windows',
    buttonText: 'Download .exe',
    caption: 'NSIS installer · x64 · auto-updates',
    Icon: WindowsIcon,
  },
  {
    os: 'mac',
    label: 'macOS',
    buttonText: 'Download .dmg',
    caption: 'Universal (Apple Silicon + Intel)',
    Icon: MacIcon,
  },
  {
    os: 'linux',
    label: 'Linux',
    buttonText: 'Download .AppImage',
    caption: 'x64',
    Icon: LinuxIcon,
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DownloadSection() {
  const { version, publishedAt, assets, loaded } = useLatestRelease();
  const userOS = detectOS();

  // Format publishedAt as "Month DD, YYYY"
  const releaseDate = publishedAt
    ? new Date(publishedAt).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null;

  // Build subtext — only append version + date when version is known
  const subtext = version
    ? `Free and open source under AGPLv3. ${version} · released ${releaseDate ?? ''}`
    : 'Free and open source under AGPLv3.';

  return (
    <section id="download" className="py-20">
      <div className="mx-auto max-w-[1200px] px-6">
        {/* Section heading */}
        <div className="mb-12 text-center">
          <h2 className="mb-4 text-heading font-bold text-midnight-navy max-md:text-heading-sm">
            Get Agent Pulse
          </h2>
          <p className="text-body-sm text-slate-blue">
            {/* Show placeholder until data arrives so layout doesn't shift */}
            {loaded ? subtext : 'Free and open source under AGPLv3.'}
          </p>
        </div>

        {/* Platform cards — 3-col desktop, 1-col mobile */}
        <div className="mb-6 grid grid-cols-1 gap-6 md:grid-cols-3">
          {platforms.map(({ os, label, buttonText, caption, Icon }) => {
            const isRecommended = os === userOS;
            const href = assets[os] ?? RELEASES_URL;

            return (
              <div
                key={os}
                className="relative flex flex-col items-center rounded-cards border border-mist-border bg-paper p-8 text-center shadow-sm"
              >
                {/* Recommended badge */}
                {isRecommended && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-badges bg-fog px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-midnight-navy">
                    Recommended for you
                  </span>
                )}

                {/* Platform icon */}
                <div className="mb-4 text-midnight-navy">
                  <Icon />
                </div>

                {/* Platform name */}
                <h3 className="mb-6 text-body-sm font-semibold text-midnight-navy">{label}</h3>

                {/* Download button */}
                <a
                  href={href}
                  {...(href !== RELEASES_URL || !assets[os]
                    ? href.startsWith('https://github.com')
                      ? { target: '_blank', rel: 'noreferrer' }
                      : {}
                    : { target: '_blank', rel: 'noreferrer' })}
                  className={[
                    'mb-4 w-full rounded-buttons px-6 py-3 text-body-sm font-semibold transition-opacity hover:opacity-90',
                    isRecommended
                      ? 'bg-signal-blue text-paper shadow-sm-3'
                      : 'border border-mist-border bg-paper text-midnight-navy',
                  ].join(' ')}
                >
                  {buttonText}
                </a>

                {/* File caption */}
                <p className="text-micro text-steel-blue">{caption}</p>
              </div>
            );
          })}
        </div>

        {/* macOS notarization footnote */}
        <p className="mb-6 text-center text-[12px] text-steel-blue">
          macOS builds aren&apos;t notarized yet &mdash; right-click the app and choose
          &ldquo;Open&rdquo; the first time.
        </p>

        {/* Fallback to all releases */}
        <p className="mb-4 text-center text-body-sm text-slate-blue">
          All versions and release notes on the{' '}
          <a
            href={RELEASES_URL}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-midnight-navy underline underline-offset-2 hover:text-signal-blue"
          >
            Releases page &nearr;
          </a>
        </p>

        {/* Self-build tertiary */}
        <p className="text-center text-body-sm text-slate-blue">
          Prefer to build it yourself?{' '}
          <code className="rounded bg-fog px-2 py-1 font-mono text-[12px] text-midnight-navy">
            git clone &rarr; npm install &rarr; npm start
          </code>
        </p>
      </div>
    </section>
  );
}
