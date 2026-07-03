/**
 * VideoShowcase — a short product demo reel.
 * A 16:9 launch video (public/brag.mp4) framed in a glass-bordered card,
 * sitting on a subtle magenta/violet GradientBlob to echo the Hero.
 * Autoplays muted + looped so it reads like an ambient preview, not a
 * click-to-play; native controls stay available.
 */
import GradientBlob from './GradientBlob';

const VIDEO_SRC = `${import.meta.env.BASE_URL}brag.mp4`;

export default function VideoShowcase() {
  return (
    <section id="demo" className="py-20">
      <div className="mx-auto max-w-[1000px] px-6">
        {/* Section title + subhead */}
        <h2 className="mb-3 text-center text-heading font-bold text-midnight-navy">
          See it in action
        </h2>
        <p className="mx-auto mb-12 max-w-[560px] text-center text-body-sm leading-relaxed text-slate-blue">
          Bubbles light up the moment an agent needs you — working, waiting,
          idle, or crashed. Here&apos;s the whole thing in twenty seconds.
        </p>

        {/* Video card floating over a gradient blob */}
        <div className="relative flex items-center justify-center">
          <GradientBlob colors={['#e55cff', '#8247f5']} className="inset-[-12%]" />

          <div
            className="relative z-10 w-full overflow-hidden border border-mist-border bg-paper"
            style={{
              borderRadius: 'var(--radius-mockup)',
              boxShadow: 'var(--shadow-sm-3)',
            }}
          >
            <video
              className="block h-auto w-full"
              src={VIDEO_SRC}
              autoPlay
              muted
              loop
              playsInline
              controls
              preload="metadata"
              aria-label="Agent Pulse product demo"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
