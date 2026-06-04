import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { BubbleTooltipPayload } from '../../../common/types';

// Padding around the glass card so its drop-shadow has room inside the window
// (anything outside the window bounds is clipped). The card itself is measured
// via this wrapper's layout size (offsetWidth/Height — transform-independent).
const SHADOW_PAD = 14;

interface TooltipMessage {
  payload: BubbleTooltipPayload;
  fresh: boolean;
}

export const TooltipOverlay: React.FC = () => {
  const [content, setContent] = useState<BubbleTooltipPayload | null>(null);
  // animKey bumps only on a fresh appearance (replays the entrance animation);
  // nonce bumps on every message (re-triggers measurement for live updates).
  const [animKey, setAnimKey] = useState(0);
  const [nonce, setNonce] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handler = (_e: unknown, msg: TooltipMessage) => {
      setContent(msg.payload);
      setNonce((n) => n + 1);
      if (msg.fresh) setAnimKey((k) => k + 1);
    };
    window.electron.on('tooltip:content', handler);
    return () => window.electron.off('tooltip:content', handler);
  }, []);

  // Report the natural (untransformed) size so the main process can size and
  // position the window precisely. offsetWidth/Height ignore the entrance
  // scale animation, so the measurement is stable.
  useLayoutEffect(() => {
    if (!content || !wrapRef.current) return;
    const el = wrapRef.current;
    window.electron.send('tooltip:measured', {
      width: el.offsetWidth,
      height: el.offsetHeight,
    });
  }, [content, nonce]);

  if (!content) return null;

  const accent = content.accent ?? 'rgba(96,165,250,0.9)';

  return (
    <div
      ref={wrapRef}
      style={{ display: 'inline-block', padding: SHADOW_PAD }}
    >
      <motion.div
        key={animKey}
        initial={{ opacity: 0, y: 4, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.14, ease: 'easeOut' }}
        className='rounded-2xl px-3.5 py-2.5'
        style={{
          maxWidth: 240,
          background: 'rgba(17,17,24,0.88)',
          backdropFilter: 'blur(18px)',
          WebkitBackdropFilter: 'blur(18px)',
          border: '1px solid rgba(255,255,255,0.12)',
          boxShadow: '0 8px 28px rgba(0,0,0,0.55)',
        }}
      >
        {/* Title + status dot */}
        <div className='flex items-center gap-2'>
          <span
            className='w-2 h-2 rounded-full shrink-0'
            style={{ background: accent, boxShadow: `0 0 8px ${accent}` }}
          />
          <span className='text-[13px] font-semibold text-white leading-tight truncate'>
            {content.title}
          </span>
        </div>

        {content.subtitle && (
          <p className='text-[11px] text-slate-400 mt-0.5 ml-4 leading-tight'>
            {content.subtitle}
          </p>
        )}

        {content.lines.length > 0 && (
          <div className='flex flex-col gap-0.5 mt-1.5'>
            {content.lines.map((line, i) => (
              <p key={i} className='text-[11px] text-slate-200/90 leading-snug'>
                {line}
              </p>
            ))}
          </div>
        )}
      </motion.div>
    </div>
  );
};
