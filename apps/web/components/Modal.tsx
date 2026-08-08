'use client';

import { ReactNode, useEffect } from 'react';
import { IconX } from './icons';
import { Alert } from './Alert';

interface Props {
  title: string;
  onClose?: () => void;
  closeDisabled?: boolean;
  maxWidth?: string;
  children: ReactNode;
}

export function Modal({ title, onClose, closeDisabled, maxWidth = 'max-w-md', children }: Props) {
  // Trava o scroll da página por trás — sem isso dá pra rolar o conteúdo atrás
  // do overlay (mais perceptível no touch, com o bounce elástico do iOS).
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  useEffect(() => {
    if (!onClose || closeDisabled) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose?.();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, closeDisabled]);

  return (
    <div className="overlay-fade fixed inset-0 z-30 flex items-center justify-center overflow-y-auto bg-slate-950/50 p-4 backdrop-blur-md">
      <div className={`modal-pop card w-full ${maxWidth} p-6`}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="section-title">{title}</h2>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              disabled={closeDisabled}
              className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            >
              <IconX className="h-4 w-4" />
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

interface ConfirmProps {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({ title, message, confirmLabel = 'Confirmar', danger, loading, error, onConfirm, onCancel }: ConfirmProps) {
  return (
    <Modal title={title} onClose={onCancel} closeDisabled={loading}>
      <p className="mb-4 text-sm text-slate-500">{message}</p>
      {error && (
        <div className="mb-4">
          <Alert variant="error">{error}</Alert>
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={loading}
          className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800"
        >
          Cancelar
        </button>
        <button type="button" onClick={onConfirm} disabled={loading} className={`px-4 py-2 text-sm ${danger ? 'btn-danger' : 'btn-primary'}`}>
          {loading ? 'Aguarde...' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
