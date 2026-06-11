import { tools } from '../data/tools';

/**
 * §4.3 — Supported-tools logo strip.
 * Centered caption + wrapping row of 6 tool logos (32px, grayscale by default,
 * full-color on hover). No props — reads directly from the tools data array.
 */
export default function ToolsStrip() {
  return (
    <section aria-label="Supported tools" className="py-12 bg-paper">
      <div className="mx-auto max-w-[1200px] px-6 flex flex-col items-center gap-8">
        {/* Caption */}
        <p className="text-caption text-slate-blue text-center">
          Watches every agent you already use
        </p>

        {/* Logo row */}
        <ul
          role="list"
          className="flex flex-wrap justify-center gap-x-10 gap-y-6"
        >
          {tools.map((tool) => (
            <li
              key={tool.name}
              className="flex flex-col items-center gap-2 group"
            >
              <img
                src={tool.logo}
                alt={tool.name}
                width={32}
                height={32}
                className={[
                  'w-8 h-8 object-contain',
                  /* grayscale 60% by default, full color on hover */
                  'grayscale opacity-60',
                  'transition-all duration-200',
                  'group-hover:grayscale-0 group-hover:opacity-100',
                ].join(' ')}
              />
              <span className="text-micro text-slate-blue select-none">
                {tool.name}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
