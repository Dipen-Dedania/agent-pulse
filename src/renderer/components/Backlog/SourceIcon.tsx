import React from 'react';
import { IssueSourceKind } from '../../../common/backlog-types';
import { SOURCE_META } from './source-meta';

// Brand logo for an issue source (GitLab / Linear / JIRA), rendered from the
// asset in public/assets. A fixed square box (className) keeps layout stable;
// the inner <img> is object-contain'd and then per-source scaled so the marks
// read the same visual size despite differing source padding (see SOURCE_META).
// Inline-block + baseline nudge so it sits nicely next to text in buttons/chips.
// Use this everywhere the board shows a source glyph — never hand-roll an <img>.
export const SourceIcon: React.FC<{ kind: IssueSourceKind; className?: string }> = ({
  kind,
  className = 'w-4 h-4',
}) => {
  const meta = SOURCE_META[kind];
  return (
    <span className={`relative inline-flex shrink-0 items-center justify-center align-[-0.2em] ${className}`}>
      <img
        src={meta.img}
        alt={meta.label}
        style={{ transform: `scale(${meta.scale})` }}
        className={`h-full w-full object-contain ${meta.invertOnLight ? 'light:invert' : ''}`}
      />
    </span>
  );
};
