import type { ReactNode } from 'react';

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center gap-2 px-4 py-12 text-center">
      {icon && (
        <span className="mb-1 flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500">
          {icon}
        </span>
      )}
      <p className="text-sm font-medium text-slate-600 dark:text-slate-300">{title}</p>
      {description && <p className="max-w-sm text-xs text-slate-400">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="card flex flex-col items-center gap-2 px-4 py-12 text-center">
      <span className="mb-1 flex h-10 w-10 items-center justify-center rounded-full bg-red-500/10 text-red-500">
        !
      </span>
      <p className="text-sm font-medium text-slate-600 dark:text-slate-300">Algo deu errado</p>
      <p className="max-w-sm text-xs text-slate-400">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="btn-secondary mt-2 px-3 py-1.5 text-xs">
          Tentar novamente
        </button>
      )}
    </div>
  );
}
