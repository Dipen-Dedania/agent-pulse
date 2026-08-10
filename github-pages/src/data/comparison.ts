/**
 * Feature comparison matrix for the Comparison section.
 *
 * Kept intentionally verifiable and consistent with the rest of the site
 * (six supported agents — see data/tools.ts). Add competitor columns by
 * extending `competitors` and adding a matching key to each row's `cells`.
 *
 * NOTE (revisit): the internal comparison doc lists two capabilities where the
 * closest alternative historically led — interactive tool-call approval and
 * mobile/remote (ntfy) push. They're omitted here rather than asserted, since
 * the current shipped state should be confirmed before publishing a losing/
 * winning claim. Add them as rows once verified.
 */

export type Cell = boolean | string;

export interface Competitor {
  /** Stable key used in each row's `cells` map */
  key: string;
  /** Column header label */
  label: string;
}

export interface ComparisonRow {
  feature: string;
  /** Agent Pulse's value for this capability */
  agentPulse: Cell;
  /** Per-competitor values, keyed by Competitor.key */
  cells: Record<string, Cell>;
}

export const competitors: Competitor[] = [{ key: 'claudePulse', label: 'Claude Pulse' }];

export const comparisonRows: ComparisonRow[] = [
  {
    feature: 'AI agents monitored',
    agentPulse: '6',
    cells: { claudePulse: '2' },
  },
  {
    feature: 'Usage from real vendor APIs',
    agentPulse: true,
    cells: { claudePulse: 'Learned estimate' },
  },
  {
    feature: 'Command guardrails',
    agentPulse: true,
    cells: { claudePulse: false },
  },
  {
    feature: 'Secret-file protection',
    agentPulse: true,
    cells: { claudePulse: false },
  },
  {
    feature: 'Analytics suite',
    agentPulse: 'Heatmap, tool mix, model usage, cost timelines',
    cells: { claudePulse: 'Heatmap only' },
  },
  {
    feature: 'Cowork / backlog scheduler',
    agentPulse: true,
    cells: { claudePulse: false },
  },
  {
    feature: 'Rich bubble states & mascots',
    agentPulse: true,
    cells: { claudePulse: false },
  },
  {
    feature: 'Desktop platforms',
    agentPulse: 'Windows, macOS, Linux',
    cells: { claudePulse: 'macOS overlay only' },
  },
  {
    feature: 'Fully local · no telemetry',
    agentPulse: true,
    cells: { claudePulse: true },
  },
  {
    feature: 'Open source',
    agentPulse: 'AGPLv3',
    cells: { claudePulse: true },
  },
];
