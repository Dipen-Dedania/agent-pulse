import { useState } from 'react';
import { LOGO_URL } from '../data/tools';
import { REPO_URL, useLatestRelease } from '../hooks/useLatestRelease';

const NAV_LINKS = [
  { label: 'Features', href: '#features' },
  { label: 'How it works', href: '#how-it-works' },
  { label: 'Privacy', href: '#privacy' },
  { label: 'FAQ', href: '#faq' },
] as const;

/**
 * Sticky top navigation bar — white bg, 68px height, hairline bottom border.
 * Center anchor links collapse into a disclosure Menu below 720px.
 */
export default function NavBar() {
  const { version } = useLatestRelease();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header
      className="sticky top-0 z-50 bg-paper border-b border-silver"
      style={{ height: 68 }}
    >
      {/* Main bar row */}
      <div className="mx-auto max-w-[1200px] px-6 flex items-center h-full gap-8">
        {/* Left: logo + wordmark */}
        <a
          href="/"
          className="flex items-center gap-2 shrink-0 no-underline"
          aria-label="Agent Pulse home"
        >
          <img src={LOGO_URL} alt="" width={28} height={28} className="shrink-0" aria-hidden />
          <span
            className="text-midnight-navy font-bold"
            style={{ fontSize: 16, letterSpacing: '-0.01em' }}
          >
            Agent Pulse
          </span>
        </a>

        {/* Center: anchor links — hidden below 720px */}
        <nav
          className="hidden min-[720px]:flex items-center gap-7 flex-1 justify-center"
          aria-label="Site navigation"
        >
          {NAV_LINKS.map(({ label, href }) => (
            <a
              key={href}
              href={href}
              className="text-caption font-medium text-midnight-navy hover:text-signal-blue transition-colors duration-150 no-underline"
            >
              {label}
            </a>
          ))}
        </nav>

        {/* Spacer on mobile so the right buttons stay right */}
        <div className="flex-1 min-[720px]:hidden" aria-hidden />

        {/* Right: GitHub ghost + Download primary */}
        <div className="flex items-center gap-3 shrink-0">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:inline-flex items-center text-caption font-medium text-midnight-navy hover:text-signal-blue transition-colors duration-150 no-underline px-3 py-1.5"
            style={{ borderRadius: 'var(--radius-buttons)' }}
          >
            GitHub&nbsp;↗
          </a>

          <a
            href="#download"
            className="inline-flex items-center text-caption font-semibold text-paper bg-signal-blue hover:bg-[#0055d4] transition-colors duration-150 no-underline px-4 py-2"
            style={{ borderRadius: 'var(--radius-buttons)', boxShadow: 'var(--shadow-sm-3)' }}
          >
            Download
            {version && (
              <span className="ml-1.5 opacity-70 font-normal hidden lg:inline">{version}</span>
            )}
          </a>

          {/* Mobile menu toggle — visible below 720px */}
          <button
            className="min-[720px]:hidden flex items-center justify-center w-8 h-8 text-midnight-navy"
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMenuOpen((v) => !v)}
          >
            {/* Simple hamburger / X icon */}
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
              {menuOpen ? (
                <>
                  <line x1="4" y1="4" x2="16" y2="16" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                  <line x1="16" y1="4" x2="4" y2="16" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                </>
              ) : (
                <>
                  <line x1="3" y1="6" x2="17" y2="6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                  <line x1="3" y1="10" x2="17" y2="10" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                  <line x1="3" y1="14" x2="17" y2="14" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                </>
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile dropdown — plain anchor list, keyboard-accessible */}
      {menuOpen && (
        <nav
          id="mobile-nav"
          className="min-[720px]:hidden bg-paper border-t border-silver px-6 pb-4 flex flex-col gap-1"
          aria-label="Mobile site navigation"
        >
          {NAV_LINKS.map(({ label, href }) => (
            <a
              key={href}
              href={href}
              className="text-body-sm font-medium text-midnight-navy hover:text-signal-blue transition-colors duration-150 no-underline py-2"
              onClick={() => setMenuOpen(false)}
            >
              {label}
            </a>
          ))}
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-body-sm font-medium text-midnight-navy hover:text-signal-blue transition-colors duration-150 no-underline py-2"
          >
            GitHub&nbsp;↗
          </a>
        </nav>
      )}
    </header>
  );
}
