import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { gentle } from '../../motion';

/**
 * Modal — the app's standard glass dialog shell. Handles the chrome and the
 * accessibility that every hand-rolled `fixed inset-0` overlay kept forgetting:
 * `role="dialog"` + `aria-modal`, Escape-to-close, a Tab focus trap, autofocus
 * of the first field, and backdrop-click dismiss. Callers supply only the body
 * (`children`) and an optional `footer` (typically Cancel / Save buttons).
 *
 * Wrap the mount in <AnimatePresence> so the exit animation plays:
 *   <AnimatePresence>{open && <Modal …>…</Modal>}</AnimatePresence>
 */
interface ModalProps {
  title: string;
  eyebrow?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Tailwind max-width class for the panel. Defaults to `max-w-lg`. */
  maxWidthClass?: string;
  /**
   * Render into a portal on `document.body` instead of inline. Needed when the
   * caller sits inside a `transform`/`filter` ancestor (e.g. a Framer-Motion
   * board column), which would otherwise become the containing block for the
   * `position: fixed` overlay and mis-position it. Off by default so existing
   * callers are unaffected.
   */
  portal?: boolean;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export const Modal: React.FC<ModalProps> = ({
  title,
  eyebrow,
  onClose,
  children,
  footer,
  maxWidthClass = 'max-w-lg',
  portal = false,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const panel = panelRef.current;
    // Land focus on the first real field so keyboard users start inside the
    // form, not on the close button behind them.
    const firstField = panel?.querySelector<HTMLElement>('input, textarea, select');
    const firstFocusable = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (firstField ?? firstFocusable)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'Tab' && panel) {
        const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const tree = (
    <motion.div
      className='fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm'
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      onClick={onClose}
    >
      <motion.div
        ref={panelRef}
        className={`glass-modal apple-scroll relative w-full ${maxWidthClass} mx-4 p-6 flex flex-col gap-4 max-h-[85vh] overflow-y-auto`}
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        transition={{ ...gentle, opacity: { duration: 0.12 } }}
        onClick={(e) => e.stopPropagation()}
        role='dialog'
        aria-modal='true'
        aria-label={title}
      >
        <button
          onClick={onClose}
          className='absolute top-4 right-4 w-7 h-7 flex items-center justify-center rounded-full bg-control/60 hover:bg-control-strong text-muted hover:text-strong transition-colors text-sm cursor-pointer'
          aria-label='Close'
        >
          ✕
        </button>
        <div>
          {eyebrow && (
            <p className='text-xs font-semibold uppercase tracking-widest text-faint mb-1'>{eyebrow}</p>
          )}
          <h2 className='text-lg font-bold text-strong'>{title}</h2>
        </div>
        {children}
        {footer && <div className='flex justify-end gap-2 mt-2'>{footer}</div>}
      </motion.div>
    </motion.div>
  );

  return portal ? createPortal(tree, document.body) : tree;
};
