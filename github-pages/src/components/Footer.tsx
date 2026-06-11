/**
 * Footer — §4.14
 * Mist background with a top hairline border.
 * Left block: logo + wordmark + tagline + copyright.
 * Right block: three link columns (Product / Project / Contact).
 * Bottom line: legal disclaimer about vendor affiliations.
 */
import { LOGO_URL } from '../data/tools';
import { REPO_URL, RELEASES_URL, ISSUES_URL, LICENSE_URL } from '../hooks/useLatestRelease';

interface LinkItem {
  label: string;
  href: string;
  external?: boolean;
}

interface LinkColumn {
  heading: string;
  links: LinkItem[];
}

const columns: LinkColumn[] = [
  {
    heading: 'Product',
    links: [
      { label: 'Features', href: '#features' },
      { label: 'Download', href: '#download' },
      { label: 'Releases ↗', href: RELEASES_URL, external: true },
    ],
  },
  {
    heading: 'Project',
    links: [
      { label: 'GitHub ↗', href: REPO_URL, external: true },
      { label: 'Issues ↗', href: ISSUES_URL, external: true },
      { label: 'License ↗', href: LICENSE_URL, external: true },
    ],
  },
  {
    heading: 'Contact',
    links: [
      {
        label: 'dipen27891@gmail.com',
        href: 'mailto:dipen27891@gmail.com',
      },
    ],
  },
];

export default function Footer() {
  return (
    <footer className="border-t border-silver bg-mist">
      {/* Main footer row */}
      <div className="mx-auto max-w-[1200px] px-6 py-12">
        <div className="flex flex-col gap-10 md:flex-row md:justify-between">
          {/* Left — brand block */}
          <div className="max-w-[280px]">
            <div className="mb-3 flex items-center gap-2">
              <img
                src={LOGO_URL}
                alt="Agent Pulse logo"
                width={24}
                height={24}
                className="h-6 w-6 object-contain"
              />
              <span className="text-body-sm font-semibold text-midnight-navy">Agent Pulse</span>
            </div>
            <p className="mb-3 text-caption text-slate-blue">
              Ambient, glanceable awareness of AI coding agents.
            </p>
            <p className="text-micro text-steel-blue">&copy; 2026 &middot; AGPLv3</p>
          </div>

          {/* Right — link columns */}
          <div className="flex flex-wrap gap-10">
            {columns.map((col) => (
              <div key={col.heading}>
                {/* Column heading */}
                <p className="mb-4 text-[11px] font-semibold uppercase tracking-widest text-steel-blue">
                  {col.heading}
                </p>
                <ul className="flex flex-col gap-3">
                  {col.links.map((link) => (
                    <li key={link.label}>
                      <a
                        href={link.href}
                        {...(link.external ? { target: '_blank', rel: 'noreferrer' } : {})}
                        className="text-caption text-slate-blue transition-colors hover:text-midnight-navy"
                      >
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom disclaimer line */}
      <div className="border-t border-silver">
        <div className="mx-auto max-w-[1200px] px-6 py-4">
          <p className="text-micro text-steel-blue">
            Not affiliated with Anthropic, OpenAI, Cursor, GitHub, AWS, or Google. Tool names and
            logos belong to their owners.
          </p>
        </div>
      </div>
    </footer>
  );
}
