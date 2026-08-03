import { IssueSourceKind } from '../../../common/backlog-types';

// Per-source display chrome for the board's population UI (link strip, header
// actions, Review & Import picker, project-filter pills). One place so the
// icon/label never drift between them. `img` is a brand logo in public/assets
// (path relative like toolMeta.ts) — render it via <SourceIcon>; use `label`
// for text/tooltip contexts where an image can't go.
//
// The source PNGs have wildly different internal padding + aspect ratios
// (gitlab 380², linear 400², jira 1088×896), so at a fixed box they'd render
// at different visual weights. `scale` nudges each so the *marks* look the same
// size next to each other — tune here, not per call site. `invertOnLight` flips
// Linear's monochrome mark (white → black) so it stays visible on the light
// theme.
export const SOURCE_META: Record<
  IssueSourceKind,
  { img: string; label: string; scale: number; invertOnLight?: boolean }
> = {
  gitlab: { img: './assets/gitlab.png', label: 'GitLab', scale: 1.0 },
  linear: { img: './assets/linear.png', label: 'Linear', scale: 1.05, invertOnLight: true },
  jira: { img: './assets/jira.png', label: 'JIRA', scale: 1.4 },
};

/** Human ref for a candidate: GitLab shows '#54'; Linear 'DEV-1036' and JIRA
 *  'DSOC-482' are already human keys, shown as-is. */
export function issueRefLabel(kind: IssueSourceKind, ref: string): string {
  return kind === 'gitlab' ? `#${ref}` : ref;
}
