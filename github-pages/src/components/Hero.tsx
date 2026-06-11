import GradientBlob from './GradientBlob';
import BubbleMockup from './BubbleMockup';
import {
  useLatestRelease,
  detectOS,
  OS_LABELS,
  REPO_URL,
  RELEASES_URL,
} from '../hooks/useLatestRelease';

/**
 * Hero section — 2-column split (stacks below 900px, text first).
 * Left: eyebrow badge, headline, subhead, CTA row, trust line.
 * Right: BubbleMockup floating over a magenta/violet GradientBlob.
 */
export default function Hero() {
  const release = useLatestRelease();
  const currentOS = detectOS();
  const osLabel = OS_LABELS[currentOS];

  // Primary download href: use the asset URL for the detected OS when available;
  // fall back to the releases page so the button is never a dead-end.
  const downloadHref = release.assets[currentOS] ?? RELEASES_URL;

  // Version caption text — only show the version fragment when the API has loaded it.
  const versionCaption = release.version
    ? `${release.version} · free · no sign-up`
    : 'free · no sign-up';

  return (
    <section
      className="relative overflow-hidden"
      style={{ paddingTop: 72, paddingBottom: 96 }}
      aria-label="Hero"
    >
      <div className="mx-auto max-w-[1200px] px-6">
        <div
          className="flex flex-col items-center text-center gap-12
                     min-[900px]:flex-row min-[900px]:items-center min-[900px]:text-left min-[900px]:gap-16"
        >
          {/* ── Left: copy column ─────────────────────────────────────────── */}
          <div className="flex-1 min-w-0 flex flex-col items-center min-[900px]:items-start gap-6">
            {/* Eyebrow badge */}
            <span
              className="inline-flex items-center text-midnight-navy font-semibold
                         rounded-badges px-3 py-1 bg-fog"
              style={{ fontSize: 12, lineHeight: 1.5, letterSpacing: '0.02em' }}
            >
              FREE &amp; OPEN SOURCE · WINDOWS · MACOS · LINUX
            </span>

            {/* Headline */}
            <h1
              className="text-midnight-navy font-bold max-w-[600px]"
              style={{
                fontSize: 'clamp(40px, 6vw, 68px)',
                lineHeight: 1.1,
              }}
            >
              Your AI agents,&nbsp;at a&nbsp;glance.
            </h1>

            {/* Subhead */}
            <p
              className="text-slate-blue max-w-[520px]"
              style={{ fontSize: 18, lineHeight: 1.64 }}
            >
              Agent Pulse floats a small glass bubble on your desktop for every
              AI coding agent you run. Working, waiting for you, idle, or
              crashed&nbsp;— you know without switching&nbsp;windows.
            </p>

            {/* CTA row */}
            <div className="flex flex-col items-center min-[900px]:items-start gap-3 w-full max-w-xs min-[900px]:max-w-none">
              {/* Primary download button */}
              <div className="flex flex-col items-center min-[900px]:items-start gap-1.5">
                <a
                  href={downloadHref}
                  className="inline-flex items-center justify-center text-paper font-semibold
                             bg-signal-blue hover:bg-[#0055d4] transition-colors duration-150
                             no-underline px-6 py-3 w-full min-[900px]:w-auto"
                  style={{
                    borderRadius: 'var(--radius-buttons)',
                    boxShadow: 'var(--shadow-sm-3)',
                    fontSize: 16,
                    lineHeight: 1.5,
                  }}
                  // Open installer downloads directly; fall-back releases page opens in same tab
                  {...(release.assets[currentOS]
                    ? {}
                    : { target: '_blank', rel: 'noopener noreferrer' })}
                >
                  Download for {osLabel}
                </a>

                {/* Version caption */}
                <p
                  className="text-steel-blue"
                  style={{ fontSize: 13, lineHeight: 1.5 }}
                >
                  {versionCaption}
                </p>
              </div>

              {/* Ghost secondary */}
              <a
                href={REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center text-midnight-navy font-medium
                           hover:text-signal-blue transition-colors duration-150 no-underline
                           px-5 py-2.5 border border-silver hover:border-signal-blue
                           w-full min-[900px]:w-auto"
                style={{
                  borderRadius: 'var(--radius-buttons)',
                  fontSize: 15,
                  lineHeight: 1.5,
                }}
              >
                View on GitHub
              </a>
            </div>

            {/* Trust line */}
            <p
              className="text-steel-blue"
              style={{ fontSize: 14, lineHeight: 1.5 }}
            >
              100% local. No account. No telemetry.
            </p>
          </div>

          {/* ── Right: mockup column ──────────────────────────────────────── */}
          <div
            className="relative flex-shrink-0 flex items-center justify-center
                       w-full min-[900px]:w-[420px]"
            style={{ minHeight: 340 }}
            aria-hidden="true"
          >
            {/* Gradient blob sits behind the mockup card */}
            <GradientBlob
              colors={['#e55cff', '#8247f5']}
              className="inset-[-15%]"
            />

            {/* Floating product card */}
            <div className="relative z-10">
              <BubbleMockup />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
