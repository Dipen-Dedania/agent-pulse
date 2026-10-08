import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { fadeQuick, listContainer } from '../../motion';
import { Eyebrow, Tooltip } from '../Shared';

interface Props {
  title: string;
  /** Cards actually rendered into this column (after any filtering). */
  count: number;
  /**
   * Cards in this state before filtering. Pass only when it can exceed `count`
   * — the header then reads "4 of 327" so a filter never hides work silently.
   */
  total?: number;
  /**
   * Cap on tiles rendered before a "+N more" expander. Keeps a long column
   * short and, just as importantly, keeps Framer Motion off hundreds of tiles.
   */
  maxVisible?: number;
  hint?: string;
  accent?: string; // tailwind text color for the count chip
  /** Filter controls rendered under the header (the Done column's chips). */
  filters?: React.ReactNode;
  droppable?: boolean; // a drag is in flight and this column accepts it
  onDropCard?: () => void;
  /** data-tour anchor id on the header, for the Backlog guided tour to spotlight. */
  dataTour?: string;
  children: React.ReactNode;
}

export const BoardColumn: React.FC<Props> = ({
  title, count, total, maxVisible, hint, accent, filters, droppable, onDropCard, dataTour, children,
}) => {
  const [dragOver, setDragOver] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Cap the rendered tiles. Drive off the real child array rather than `count`
  // so the expander can never disagree with what's on screen.
  const items = React.Children.toArray(children);
  const shown = maxVisible != null && !expanded ? items.slice(0, maxVisible) : items;
  const hidden = items.length - shown.length;
  // A filter is hiding cards (as opposed to the column genuinely being empty).
  const filteredOut = total != null && total > count;

  return (
    // `layout` on the column lets the grid settle smoothly when the attention
    // rail appears/disappears. `initial/animate` fade the column in on mount.
    <motion.div
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={fadeQuick}
      onDragOver={droppable ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOver(true); } : undefined}
      onDragLeave={(e) => {
        // Ignore leave events fired when the pointer moves onto a child.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false);
      }}
      onDrop={droppable ? (e) => { e.preventDefault(); setDragOver(false); onDropCard?.(); } : undefined}
      className={`glass-primary p-4 flex flex-col gap-3 min-h-40 transition-colors ${
        droppable && dragOver ? 'border-blue-400/70 bg-control/60' : ''
      }`}
    >
      <div data-tour={dataTour}>
        <Eyebrow
          size='md'
          tone='muted'
          right={
            <>
              <Tooltip content={filteredOut ? `${count} shown of ${total} in this column` : undefined}>
                <span className={`text-[11px] px-1.5 py-0.5 rounded-md bg-control/60 ${accent ?? 'text-body'}`}>
                  {filteredOut ? `${count} of ${total}` : count}
                </span>
              </Tooltip>
              {hint && (
                <Tooltip content={hint}>
                  <span className='text-[11px] text-faint truncate'>{hint}</span>
                </Tooltip>
              )}
            </>
          }
        >
          {title}
        </Eyebrow>
      </div>

      {filters}

      {/* Staggered card list — AnimatePresence enables enter/exit animations
          for cards added or removed from this column. listContainer staggers
          children by 35 ms so they cascade in on first render. */}
      <motion.div
        className='flex flex-col gap-2 flex-1'
        variants={listContainer}
        initial='initial'
        animate='animate'
      >
        <AnimatePresence initial={false}>
          {items.length === 0 ? (
            <motion.p
              key='__empty'
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={fadeQuick}
              className='text-xs text-faint'
            >
              {/* "Empty" would read as data loss when a filter is what emptied it. */}
              {filteredOut ? `No cards match — ${total} hidden by this filter` : 'Empty'}
            </motion.p>
          ) : shown}
        </AnimatePresence>
      </motion.div>

      {hidden > 0 && (
        <button
          onClick={() => setExpanded(true)}
          className='self-start text-[11px] px-2 py-1 rounded-md bg-control/50 text-muted hover:bg-control-strong hover:text-strong cursor-pointer transition-colors'
        >
          + {hidden} more
        </button>
      )}
      {expanded && maxVisible != null && items.length > maxVisible && (
        <button
          onClick={() => setExpanded(false)}
          className='self-start text-[11px] px-2 py-1 rounded-md bg-control/50 text-muted hover:bg-control-strong hover:text-strong cursor-pointer transition-colors'
        >
          Show fewer
        </button>
      )}
    </motion.div>
  );
};
