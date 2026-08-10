/**
 * Comparison — "How Agent Pulse compares"
 * A responsive feature matrix. Agent Pulse's column is highlighted. Boolean
 * cells render as ✓ / ✕; string cells render the detail text. The table
 * scrolls horizontally on narrow screens so the page body never does.
 */
import { comparisonRows, competitors, type Cell } from '../data/comparison';

function CellValue({ value, emphasis }: { value: Cell; emphasis?: boolean }) {
  if (value === true) {
    return (
      <span
        className={emphasis ? 'text-signal-blue' : 'text-slate-blue'}
        aria-label="Yes"
        title="Yes"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden className="inline">
          <path
            d="M5 13l4 4L19 7"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }
  if (value === false) {
    return (
      <span className="text-steel-blue" aria-label="No" title="No">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden className="inline">
          <path
            d="M6 6l12 12M18 6L6 18"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </span>
    );
  }
  return (
    <span className={emphasis ? 'text-body-sm font-medium text-midnight-navy' : 'text-body-sm text-slate-blue'}>
      {value}
    </span>
  );
}

export default function Comparison() {
  return (
    <section id="comparison" className="py-20">
      <div className="mx-auto max-w-[1000px] px-6">
        <h2 className="mb-4 text-center text-heading font-bold text-midnight-navy max-md:text-heading-sm">
          How Agent Pulse compares
        </h2>
        <p className="mb-12 text-center text-body-sm text-slate-blue">
          A quick look at capabilities next to the closest open-source alternative.
        </p>

        <div className="overflow-x-auto rounded-cards border border-mist-border shadow-sm">
          <table className="w-full min-w-[560px] border-collapse bg-paper text-left">
            <thead>
              <tr className="border-b border-mist-border">
                <th className="px-5 py-4 text-caption font-semibold uppercase tracking-wide text-steel-blue">
                  Capability
                </th>
                <th className="bg-fog/60 px-5 py-4 text-body-sm font-bold text-midnight-navy">
                  Agent Pulse
                </th>
                {competitors.map((c) => (
                  <th key={c.key} className="px-5 py-4 text-body-sm font-semibold text-slate-blue">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {comparisonRows.map((row) => (
                <tr key={row.feature} className="border-b border-mist-border last:border-0">
                  <th
                    scope="row"
                    className="px-5 py-4 text-body-sm font-medium text-midnight-navy"
                  >
                    {row.feature}
                  </th>
                  <td className="bg-fog/60 px-5 py-4">
                    <CellValue value={row.agentPulse} emphasis />
                  </td>
                  {competitors.map((c) => (
                    <td key={c.key} className="px-5 py-4">
                      <CellValue value={row.cells[c.key] ?? false} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-4 text-center text-micro text-steel-blue">
          Comparison compiled {new Date().getFullYear()}. Alternatives evolve — corrections welcome via a GitHub issue.
        </p>
      </div>
    </section>
  );
}
