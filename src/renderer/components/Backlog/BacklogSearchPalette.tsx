import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BacklogCard, BacklogProject } from '../../../common/backlog-types';
import { EmptyState, Modal } from '../Shared';
import { searchCards } from './card-search';
import { TIER_META } from './CardTile';
import { projectColor } from './project-colors';

// ⌘K/Ctrl-K find-cards palette for the Backlog board. Backlog-scoped: mounted in
// BacklogBoardTab, it only searches board cards. Enter (or click) opens the
// picked card in the existing editor — no separate navigation. Search logic is
// in card-search.ts so it's unit-tested; this component is just the surface.

interface Props {
  cards: BacklogCard[];
  projects: BacklogProject[];
  onPick: (card: BacklogCard) => void;
  onClose: () => void;
}

export const BacklogSearchPalette: React.FC<Props> = ({ cards, projects, onPick, onClose }) => {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const projectsById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const hits = useMemo(() => searchCards(cards, projectsById, query), [cards, projectsById, query]);

  // Reset the highlight to the top whenever the result set changes.
  useEffect(() => { setActiveIndex(0); }, [query]);

  // Keep the highlighted row visible as arrow keys move it.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const commit = (i: number) => {
    const hit = hits[i];
    if (hit) onPick(hit.card);
  };

  const onInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, hits.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      commit(activeIndex);
    }
  };

  return (
    <Modal title='Find cards' onClose={onClose} portal maxWidthClass='max-w-xl'>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onInputKeyDown}
        placeholder='Search cards by title, description, or project…'
        className='bg-glass/60 border border-edge/70 rounded-lg px-3 py-2 text-sm text-strong focus:outline-none focus:border-blue-500/60'
        aria-label='Search cards'
      />

      {hits.length === 0 ? (
        <EmptyState boxed>
          {query.trim() ? `No cards match “${query.trim()}”` : 'No cards on the board yet'}
        </EmptyState>
      ) : (
        <div
          ref={listRef}
          className='apple-scroll flex flex-col gap-1 max-h-[50vh] overflow-y-auto -m-1 p-1'
        >
          {hits.map((hit, i) => {
            const card = hit.card;
            const active = i === activeIndex;
            const pc = projectColor(card.projectId);
            const projName = projectsById.get(card.projectId)?.name ?? 'unknown';
            return (
              <button
                key={card.id}
                data-active={active}
                onClick={() => onPick(card)}
                onMouseEnter={() => setActiveIndex(i)}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-left cursor-pointer transition-colors ${
                  active ? 'bg-control text-strong' : 'hover:bg-control/50'
                }`}
              >
                <span className={`w-2 h-2 rounded-full shrink-0 ${TIER_META[card.riskTier].dot}`} />
                <span className='flex-1 min-w-0 text-sm text-body truncate'>{card.title}</span>
                <span className={`px-1.5 py-0.5 rounded text-[11px] shrink-0 ${pc.chip}`}>{projName}</span>
                <span className='px-1.5 py-0.5 rounded text-[11px] shrink-0 bg-control/60 text-muted'>
                  {card.state}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <p className='text-[11px] text-faint'>↑↓ to navigate · Enter to open · Esc to close</p>
    </Modal>
  );
};
