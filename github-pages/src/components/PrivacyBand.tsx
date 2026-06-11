/**
 * PrivacyBand — §4.11
 * Full-width midnight-navy strip — the page's single dark section.
 * Centered white title, light steel-blue body copy, ghost "Read the source" link.
 */
import { REPO_URL } from '../hooks/useLatestRelease';

export default function PrivacyBand() {
  return (
    <section id="privacy" className="bg-midnight-navy py-24">
      <div className="mx-auto max-w-[1200px] px-6 text-center">
        {/* Title */}
        <h2 className="mb-6 text-heading font-bold text-paper max-md:text-heading-sm">
          Local-first, by architecture
        </h2>

        {/* Body copy — max-width ~720px, centered, light steel-blue */}
        <p className="mx-auto mb-10 max-w-[720px] text-body text-steel-blue">
          Hooks talk to a bridge on your own machine. The timeline is a SQLite file in your user
          folder. Usage meters call the vendors&apos; own APIs with your existing credentials. There
          is no Agent Pulse server, no account, and no telemetry &mdash; there&apos;s nowhere for
          your data to go.
        </p>

        {/* Ghost-on-dark link */}
        <a
          href={REPO_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-block border-b border-paper/50 pb-0.5 text-body-sm font-medium text-paper transition-colors hover:border-paper hover:text-paper/90"
        >
          Read the source &rarr;
        </a>
      </div>
    </section>
  );
}
