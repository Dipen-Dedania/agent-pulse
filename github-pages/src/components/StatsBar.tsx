/**
 * §4.4 — Social-proof stats bar.
 * Three centered stats: large number (38–50px 700 navy) + label (16px slate-blue).
 * 3-col on desktop → 1-col stacked on mobile.
 */

interface Stat {
  number: string;
  label: string;
}

const STATS: Stat[] = [
  { number: '6 tools', label: 'one unified status bridge' },
  { number: '0 bytes', label: 'sent to any server — fully local' },
  { number: '1 click', label: 'to install or remove every hook' },
];

export default function StatsBar() {
  return (
    <section aria-label="Key stats" className="py-16 bg-mist border-y border-mist-border">
      <div className="mx-auto max-w-[1200px] px-6">
        <ul
          role="list"
          className="grid grid-cols-1 sm:grid-cols-3 gap-10 sm:gap-6"
        >
          {STATS.map((stat) => (
            <li
              key={stat.number}
              className="flex flex-col items-center gap-2 text-center"
            >
              {/* Number — 38px on mobile, 50px on sm+ */}
              <span
                className="font-bold text-midnight-navy leading-none"
                style={{ fontSize: 'clamp(38px, 4vw, 50px)' }}
              >
                {stat.number}
              </span>
              {/* Label */}
              <span className="text-body-sm text-slate-blue max-w-[200px]">
                {stat.label}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
