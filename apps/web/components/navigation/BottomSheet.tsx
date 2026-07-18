'use client';

import { ReactNode, useEffect } from 'react';
import { IconX } from '../icons';

export function BottomSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  return (
    <div className="overlay-fade fixed inset-0 z-40 flex items-end bg-slate-950/50 backdrop-blur-sm md:hidden" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="sheet-rise w-full rounded-t-2xl border-t border-slate-200 bg-white pb-[calc(env(safe-area-inset-bottom)+12px)] shadow-2xl dark:border-slate-700 dark:bg-slate-900"
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-slate-300 dark:bg-slate-700" aria-hidden />
        <div className="flex items-center justify-between px-5 pb-2 pt-3">
          <h2 className="section-title">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <IconX className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
