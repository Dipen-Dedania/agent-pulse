/**
 * §4.4 — Social-proof stats bar.
 * Centered stats: large number (38–50px 700 navy) + label (16px slate-blue).
 * The GitHub star count is live (from the repo API); the rest are static
 * product facts. 4-col on desktop → 2-col → 1-col on mobile.
 */
import { REPO_URL, useRepoStats } from '../hooks/useLatestRelease';

interface Stat {
  number: string;
  label: string;
  /** Optional external link (used for the live star count) */
  href?: string;
}

export default function StatsBar() {
  const { stars, loaded } = useRepoStats();

  // Live star count — falls back to a neutral placeholder until the API
  // settles so the big number never causes layout shift.
  const starNumber =
    loaded && stars !== null ? `${stars.toLocaleString('en-US')} ★` : '★';

  const stats: Stat[] = [
    { number: starNumber, label: 'stars on GitHub — join us', href: `${REPO_URL}/stargazers` },
    { number: '6 tools', label: 'one unified status bridge' },
    { number: '0 bytes', label: 'sent to any server — fully local' },
    { number: '1 click', label: 'to install or remove every hook' },
  ];

  return (
    <section aria-label="Key stats" className="py-16 bg-mist border-y border-mist-border">
      <div className="mx-auto max-w-[1200px] px-6">
        <ul
          role="list"
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10 sm:gap-6"
        >
          {stats.map((stat) => {
            const content = (
              <>
                {/* Number — 38px on mobile, 50px on sm+ */}
                <span
                  className="font-bold text-midnight-navy leading-none"
                  style={{ fontSize: 'clamp(38px, 4vw, 50px)' }}
                >
                  {stat.number}
                </span>
                {/* Label */}
                <span className="text-body-sm text-slate-blue max-w-[200px]">{stat.label}</span>
              </>
            );

            return (
              <li key={stat.label} className="flex flex-col items-center gap-2 text-center">
                {stat.href ? (
                  <a
                    href={stat.href}
                    target="_blank"
                    rel="noreferrer"
                    className="flex flex-col items-center gap-2 no-underline transition-opacity hover:opacity-80"
                  >
                    {content}
                  </a>
                ) : (
                  content
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
