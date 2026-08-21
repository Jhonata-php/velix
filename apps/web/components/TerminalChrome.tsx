import type { ReactNode } from 'react';

/** Janela com cara de terminal (bolinhas + barra de título escura) — usada pelo terminal SSH,
 * console de banco e visualizadores de log, pra dar uma identidade única e consistente. */
export function TerminalWindow({
  title,
  statusSlot,
  actions,
  children,
  bodyClassName = '',
  className = '',
}: {
  title: ReactNode;
  statusSlot?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  bodyClassName?: string;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 ${className}`}
    >
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2.5 dark:border-white/5 dark:bg-slate-800">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex shrink-0 gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
          </div>
          <h2 className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">{title}</h2>
          {statusSlot}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </div>
      <div className={`bg-white dark:bg-slate-900 ${bodyClassName}`}>{children}</div>
    </div>
  );
}

export function TerminalModal(props: Parameters<typeof TerminalWindow>[0] & { maxWidth?: string }) {
  const { maxWidth = 'max-w-2xl', className = '', ...rest } = props;
  return (
    <div className="overlay-fade fixed inset-0 z-30 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-md">
      <div className={`modal-pop w-full ${maxWidth}`}>
        <TerminalWindow {...rest} className={`max-h-[85vh] shadow-2xl ${className}`} />
      </div>
    </div>
  );
}

export function TerminalActionButton({
  onClick,
  disabled,
  title,
  tone = 'default',
  children,
}: {
  onClick?: () => void;
  disabled?: boolean;
  title: string;
  tone?: 'default' | 'success' | 'danger';
  children: ReactNode;
}) {
  const toneClass =
    tone === 'success'
      ? 'text-green-600 dark:text-green-400'
      : tone === 'danger'
        ? 'text-slate-500 hover:text-red-500 dark:text-slate-300 dark:hover:text-red-400'
        : 'text-slate-500 dark:text-slate-300';
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded-lg p-1.5 transition hover:bg-slate-100 disabled:opacity-40 dark:hover:bg-white/5 ${toneClass}`}
    >
      {children}
    </button>
  );
}
