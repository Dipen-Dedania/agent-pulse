/**
 * Community — contributors wall + a compact brand/press kit.
 * Contributors come from the GitHub API (see useContributors); avatars load
 * from GitHub, so no new third-party host is introduced. The press kit offers
 * the logo, brand colors, and a one-line boilerplate for anyone writing about
 * the project.
 *
 * No sponsor button is shown: .github/FUNDING.yml currently has no active
 * funding links, so a "Sponsor" CTA would dead-end. Add one here once funding
 * is enabled.
 */
import { LOGO_URL } from '../data/tools';
import { REPO_URL, useContributors } from '../hooks/useLatestRelease';

const CONTRIBUTING_URL = `${REPO_URL}/blob/main/CONTRIBUTING.md`;

interface Swatch {
  name: string;
  hex: string;
  /** Dark text needed for legibility on light swatches */
  darkText?: boolean;
}

const swatches: Swatch[] = [
  { name: 'Midnight Navy', hex: '#0b3558' },
  { name: 'Signal Blue', hex: '#006bff' },
  { name: 'Slate Blue', hex: '#476788' },
  { name: 'Mist', hex: '#f8f9fb', darkText: true },
];

const BOILERPLATE =
  'Agent Pulse is a free, open-source desktop app that gives you ambient, glanceable awareness of your AI coding agents — floating status bubbles, live usage meters, local analytics, and command guardrails. 100% local, no telemetry.';

export default function Community() {
  const { contributors, loaded } = useContributors();

  return (
    <section id="community" className="py-20 scroll-mt-24">
      <div className="mx-auto max-w-[1000px] px-6">
        <h2 className="mb-4 text-center text-heading font-bold text-midnight-navy max-md:text-heading-sm">
          Built in the open
        </h2>
        <p className="mb-12 text-center text-body-sm text-slate-blue">
          Agent Pulse is AGPLv3 open source. Read the code, file issues, send PRs.
        </p>

        {/* Contributors wall */}
        {loaded && contributors.length > 0 && (
          <div className="mb-14">
            <p className="mb-6 text-center text-micro uppercase tracking-widest text-steel-blue">
              Contributors
            </p>
            <ul role="list" className="flex flex-wrap justify-center gap-3">
              {contributors.map((c) => (
                <li key={c.login}>
                  <a
                    href={c.profileUrl}
                    target="_blank"
                    rel="noreferrer"
                    title={c.login}
                    className="block rounded-full ring-1 ring-mist-border transition-transform duration-150 hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-blue"
                  >
                    <img
                      src={c.avatarUrl}
                      alt={c.login}
                      width={44}
                      height={44}
                      loading="lazy"
                      className="h-11 w-11 rounded-full object-cover"
                    />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* CTA */}
        <div className="mb-16 flex flex-wrap items-center justify-center gap-3">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center rounded-buttons bg-signal-blue px-5 py-2.5 text-body-sm font-semibold text-paper shadow-sm-3 transition-opacity hover:opacity-90 no-underline"
          >
            Star on GitHub ★
          </a>
          <a
            href={CONTRIBUTING_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center rounded-buttons border border-mist-border bg-paper px-5 py-2.5 text-body-sm font-semibold text-midnight-navy transition-colors hover:bg-fog no-underline"
          >
            How to contribute ↗
          </a>
        </div>

        {/* Press / brand kit */}
        <div className="rounded-cards border border-mist-border bg-paper p-8 shadow-sm">
          <h3 className="mb-6 text-body font-bold text-midnight-navy">Press &amp; brand kit</h3>
          <div className="grid grid-cols-1 gap-8 md:grid-cols-[auto_1fr]">
            {/* Logo */}
            <div className="flex flex-col items-center gap-3">
              <div className="flex h-24 w-24 items-center justify-center rounded-cards bg-mist">
                <img src={LOGO_URL} alt="Agent Pulse logo" className="h-16 w-16 object-contain" />
              </div>
              <a
                href={LOGO_URL}
                download
                className="text-caption font-medium text-signal-blue underline underline-offset-2"
              >
                Download logo
              </a>
            </div>

            {/* Colors + boilerplate */}
            <div>
              <p className="mb-3 text-micro uppercase tracking-widest text-steel-blue">Colors</p>
              <ul role="list" className="mb-6 flex flex-wrap gap-3">
                {swatches.map((s) => (
                  <li key={s.hex} className="flex items-center gap-2">
                    <span
                      className="inline-block h-6 w-6 rounded-full ring-1 ring-mist-border"
                      style={{ backgroundColor: s.hex }}
                      aria-hidden
                    />
                    <span className="text-micro text-slate-blue">
                      {s.name} <span className="text-steel-blue">{s.hex}</span>
                    </span>
                  </li>
                ))}
              </ul>

              <p className="mb-3 text-micro uppercase tracking-widest text-steel-blue">Boilerplate</p>
              <p className="text-body-sm text-slate-blue">{BOILERPLATE}</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
