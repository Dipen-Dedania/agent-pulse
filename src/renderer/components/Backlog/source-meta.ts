import { IssueSourceKind } from '../../../common/backlog-types';

// Per-source display chrome for the board's population UI (link strip, header
// actions, Review & Import picker, project-filter pills). One place so the
// icon/label never drift between them.
export const SOURCE_META: Record<IssueSourceKind, { icon: string; label: string }> = {
  gitlab: { icon: '🦊', label: 'GitLab' },
  linear: { icon: '▲', label: 'Linear' },
};

/** Human ref for a candidate: GitLab shows '#54', Linear shows 'DEV-1036'. */
export function issueRefLabel(kind: IssueSourceKind, ref: string): string {
  return kind === 'gitlab' ? `#${ref}` : ref;
}
