import React, { useState } from 'react';
import { EmptyState, Input, Radio } from '../Shared';

// Single-select glass radio-card list used by the source-link pickers
// (LinearLinkModal, JiraLinkModal). Each option is a whole-card <label> with a
// ring when selected — the pattern that was hand-rolled once per step per modal.
// Multi-select lists (IssueImportModal's checkboxes) are a different control and
// deliberately not covered here.

export interface RadioCardOption {
  /** Stable value passed back to onSelect and compared against `selected`. */
  id: string;
  label: string;
  /** Optional mono chip before the label (e.g. a team/project key). */
  badge?: string;
  /** Optional faint secondary line after the label (e.g. a site URL). */
  sub?: string;
}

interface Props {
  /** Radio group name — shared across the rows so the browser treats them as one group. */
  name: string;
  options: RadioCardOption[];
  /** Currently selected id, or null. */
  selected: string | null;
  onSelect: (id: string) => void;
  /** An always-present leading choice (e.g. "All issues in this team"). */
  leadingOption?: RadioCardOption;
  /** Shown when `options` is empty and there is no leadingOption. */
  emptyText: string;
  /**
   * Show a filter box above the list. Defaults to on once the list is long
   * enough to be awkward (a real Jira account can list 30+ projects). The
   * `leadingOption` is never filtered — it stays pinned.
   */
  searchable?: boolean;
  /** Placeholder for the filter box (e.g. "Filter projects…"). */
  searchPlaceholder?: string;
}

export const RadioCardList: React.FC<Props> = ({
  name, options, selected, onSelect, leadingOption, emptyText, searchable, searchPlaceholder,
}) => {
  const [filter, setFilter] = useState('');
  const showSearch = searchable ?? options.length > 8;
  const q = filter.trim().toLowerCase();
  const filtered = q === ''
    ? options
    : options.filter((o) =>
        o.label.toLowerCase().includes(q) ||
        (o.badge?.toLowerCase().includes(q) ?? false) ||
        (o.sub?.toLowerCase().includes(q) ?? false));

  const row = (opt: RadioCardOption) => {
    const on = selected === opt.id;
    return (
      <label
        key={opt.id}
        className={`glass-secondary shrink-0 p-3 flex items-center gap-3 text-left transition-colors cursor-pointer ${on ? 'ring-2 ring-blue-400/70' : 'hover:bg-control/40'}`}
      >
        <Radio name={name} checked={on} onChange={() => onSelect(opt.id)} ariaLabel={`Select ${opt.label}`} />
        {opt.badge && (
          <span className='px-1.5 py-0.5 rounded text-[11px] bg-control/50 text-body font-mono'>{opt.badge}</span>
        )}
        <span className='text-sm text-strong truncate'>{opt.label}</span>
        {opt.sub && <span className='text-[11px] text-faint truncate'>{opt.sub}</span>}
      </label>
    );
  };

  return (
    <div className='flex-1 min-h-0 flex flex-col gap-2'>
      {showSearch && (
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={searchPlaceholder ?? 'Filter…'}
          aria-label={searchPlaceholder ?? 'Filter list'}
        />
      )}
      <div className='apple-scroll flex-1 min-h-0 overflow-y-auto flex flex-col gap-2 -m-1 p-1'>
        {leadingOption && row(leadingOption)}
        {filtered.length === 0 && !leadingOption ? (
          <EmptyState boxed>{q ? `No matches for “${filter.trim()}”` : emptyText}</EmptyState>
        ) : (
          filtered.map(row)
        )}
      </div>
    </div>
  );
};
