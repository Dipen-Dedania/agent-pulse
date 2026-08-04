import React from 'react';
import { Button, GlassToggle, Spinner } from '../Shared';

// Shared building blocks for the Guardrails and Secret Protection sub-tabs.
// The two surfaces were near-verbatim copies (rule row, add-rule form fields,
// loading state); this module is the single source so a fix lands in both.

// ── Loading state ─────────────────────────────────────────────────────────────

/** Spinner + label shown while a tab's config is still loading over IPC. */
export const TabLoading: React.FC<{ label: string }> = ({ label }) => (
  <div className='flex items-center gap-3 text-muted'>
    <Spinner size='md' />
    {label}
  </div>
);

// ── Add-rule form fields ──────────────────────────────────────────────────────

/** Shared input styling for the add-rule modals. */
export const inputCls =
  'glass-secondary rounded-lg w-full px-3 py-2 text-sm text-strong placeholder:text-faint focus:outline-none focus:border-blue-500/60';

/** Labeled form field wrapper used inside the add-rule modals. */
export const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <p className='text-xs font-semibold uppercase tracking-wider text-faint mb-1.5'>{label}</p>
    {children}
  </div>
);

// ── Rule row ──────────────────────────────────────────────────────────────────

interface RuleRowProps {
  /** Optional leading pill (e.g. the guardrail tier badge). */
  badge?: React.ReactNode;
  /** Primary identifier line — the caller controls the <code> color. */
  title: React.ReactNode;
  /** Inline metadata shown next to the title (e.g. the OS list). */
  meta?: React.ReactNode;
  isCustom?: boolean;
  message?: string;
  /** Secondary code line (regex pattern or rule id). */
  subtext?: React.ReactNode;
  /** Suggested-fix hint, rendered with a leading arrow. */
  hint?: string;
  enabled: boolean;
  onToggle: () => void;
  toggleLabel: string;
  /** When present, renders a Delete action (custom rules only). */
  onDelete?: () => void;
}

/**
 * A single rule/glob row: leading badge, an identifier + message + secondary
 * code column, and a trailing enable toggle with an optional Delete action.
 * Disabled rows dim. Secondary text uses `text-muted` (not `text-faint`) so the
 * regex/id stays legible against the light-theme glass surface.
 */
export const RuleRow: React.FC<RuleRowProps> = ({
  badge,
  title,
  meta,
  isCustom,
  message,
  subtext,
  hint,
  enabled,
  onToggle,
  toggleLabel,
  onDelete,
}) => (
  <div className={`glass-secondary flex items-start gap-3 p-3 ${enabled ? '' : 'opacity-50'}`}>
    {badge && <span className='shrink-0 mt-0.5'>{badge}</span>}
    <div className='flex-1 min-w-0'>
      <div className='flex items-center gap-2'>
        {title}
        {meta}
        {isCustom && <span className='text-[10px] text-blue-400 font-medium'>custom</span>}
      </div>
      {message && <p className='text-sm text-body mt-0.5'>{message}</p>}
      {subtext}
      {hint && <p className='text-[11px] text-muted mt-1 italic'>→ {hint}</p>}
    </div>
    <div className='flex flex-col items-end gap-1.5 shrink-0'>
      <GlassToggle checked={enabled} onChange={onToggle} size='sm' label={toggleLabel} />
      {onDelete && (
        <Button variant='ghost' size='xs' className='text-faint hover:text-danger' onClick={onDelete}>
          Delete
        </Button>
      )}
    </div>
  </div>
);
