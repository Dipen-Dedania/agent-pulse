import React, { useState } from 'react';

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
    <div
      onDragOver={droppable ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOver(true); } : undefined}
      onDragLeave={(e) => {
        // Ignore leave events fired when the pointer moves onto a child.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false);
      }}
      onDrop={droppable ? (e) => { e.preventDefault(); setDragOver(false); onDropCard?.(); } : undefined}
      className={`bg-glass/60 backdrop-blur-md border rounded-2xl p-4 shadow-xl flex flex-col gap-3 min-h-40 transition-colors ${
        droppable && dragOver ? 'border-blue-400/70 bg-control/60' : 'border-edge/70'
      }`}
    >
      <div className='flex items-center gap-2'>
        <p className='text-xs uppercase tracking-widest text-muted font-semibold'>{title}</p>
        <span className={`text-[11px] px-1.5 py-0.5 rounded-md bg-control/60 ${accent ?? 'text-body'}`}>{count}</span>
        {hint && <span className='text-[11px] text-faint truncate' title={hint}>{hint}</span>}
      </div>
      <div className='flex flex-col gap-2 flex-1'>
        {count === 0 ? <p className='text-xs text-faint'>Empty</p> : children}
      </div>
    </div>
  );
};
