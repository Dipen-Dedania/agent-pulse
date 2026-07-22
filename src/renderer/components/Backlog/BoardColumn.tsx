import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { listContainer } from '../../motion';
import { Tooltip } from '../Shared';

interface Props {
  title: string;
  count: number;
  hint?: string;
  accent?: string; // tailwind text color for the count chip
  droppable?: boolean; // a drag is in flight and this column accepts it
  onDropCard?: () => void;
  children: React.ReactNode;
}

export const BoardColumn: React.FC<Props> = ({ title, count, hint, accent, droppable, onDropCard, children }) => {
  const [dragOver, setDragOver] = useState(false);
  return (
    // `layout` on the column lets the grid settle smoothly when the attention
    // rail appears/disappears. `initial/animate` fade the column in on mount.
    <motion.div
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
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
      <div className='flex items-center gap-2'>
        <p className='text-xs uppercase tracking-widest text-muted font-semibold'>{title}</p>
        <span className={`text-[11px] px-1.5 py-0.5 rounded-md bg-control/60 ${accent ?? 'text-body'}`}>{count}</span>
        {hint && (
          <Tooltip content={hint}>
            <span className='text-[11px] text-faint truncate'>{hint}</span>
          </Tooltip>
        )}
      </div>

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
          {count === 0 ? (
            <motion.p
              key='__empty'
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className='text-xs text-faint'
            >
              Empty
            </motion.p>
          ) : children}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
};
