import React, { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { create } from 'zustand';

// App-styled replacement for native alert()/confirm(): promise-based API over
// a Zustand queue, rendered once per window by <AppDialogHost/>. Native
// dialogs block Electron's whole renderer process and ignore the Apple Glass
// design; these do neither. Concurrent requests queue and show one at a time.
//
//   await appAlert('Something failed', 'Hooks');
//   if (await appConfirm({ title: 'Delete card?', danger: true })) { … }

interface DialogRequest {
  id: number;
  kind: 'alert' | 'confirm';
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  danger: boolean;
  resolve: (ok: boolean) => void;
}

interface DialogQueue {
  queue: DialogRequest[];
  push: (req: DialogRequest) => void;
  settle: (ok: boolean) => void;
}

const useDialogStore = create<DialogQueue>((set, get) => ({
  queue: [],
  push: (req) => set((s) => ({ queue: [...s.queue, req] })),
  settle: (ok) => {
    const current = get().queue[0];
    if (!current) return;
    current.resolve(ok);
    set((s) => ({ queue: s.queue.slice(1) }));
  },
}));

let nextId = 1;

/** Styled alert. Resolves when dismissed. */
export function appAlert(message: string, title = 'Notice'): Promise<void> {
  return new Promise((resolve) => {
    useDialogStore.getState().push({
      id: nextId++,
      kind: 'alert',
      title,
      message,
      confirmLabel: 'OK',
      cancelLabel: '',
      danger: false,
      resolve: () => resolve(),
    });
  });
}

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean; // red confirm button for destructive actions
}

/** Styled confirm. Resolves true only on explicit confirmation. */
export function appConfirm(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    useDialogStore.getState().push({
      id: nextId++,
      kind: 'confirm',
      title: opts.title,
      message: opts.message,
      confirmLabel: opts.confirmLabel ?? 'Confirm',
      cancelLabel: opts.cancelLabel ?? 'Cancel',
      danger: opts.danger ?? false,
      resolve,
    });
  });
}

/**
 * Renders the active dialog. Mount ONCE at the window root, after all other
 * content so it stacks above every hand-rolled modal (z-[100] beats the card
 * editor's z-50 and the template manager's z-[60]).
 */
export const AppDialogHost: React.FC = () => {
  const current = useDialogStore((s) => s.queue[0]);
  const settle = useDialogStore((s) => s.settle);

  // Escape cancels, Enter confirms — same muscle memory as the native dialogs.
  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); settle(false); }
      if (e.key === 'Enter') { e.preventDefault(); settle(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, settle]);

  return (
    <AnimatePresence>
      {current && (
        <motion.div
          key={current.id}
          className='fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm'
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={() => settle(false)}
        >
          <motion.div
            className='w-full max-w-md mx-4 bg-slate-900/95 border border-slate-700/70 rounded-2xl shadow-2xl p-6 flex flex-col gap-3'
            initial={{ opacity: 0, scale: 0.95, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            transition={{ duration: 0.15 }}
            onClick={(e) => e.stopPropagation()}
            role='dialog'
            aria-modal='true'
            aria-label={current.title}
          >
            <h2 className='text-base font-bold text-white leading-tight'>{current.title}</h2>
            <p className='text-sm text-slate-300 leading-relaxed whitespace-pre-wrap break-words'>{current.message}</p>
            <div className='flex items-center justify-end gap-2 mt-2'>
              {current.kind === 'confirm' && (
                <button
                  onClick={() => settle(false)}
                  className='px-4 py-2 rounded-lg text-sm font-medium bg-slate-700 hover:bg-slate-600 text-slate-300 cursor-pointer transition-colors'
                >
                  {current.cancelLabel}
                </button>
              )}
              <button
                autoFocus
                onClick={() => settle(true)}
                className={`px-4 py-2 rounded-lg text-sm font-medium text-white cursor-pointer transition-colors ${
                  current.danger ? 'bg-red-600 hover:bg-red-500' : 'bg-blue-600 hover:bg-blue-500'
                }`}
              >
                {current.confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
