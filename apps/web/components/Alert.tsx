type AlertVariant = 'success' | 'error' | 'warning' | 'info';

const VARIANT_STYLES: Record<AlertVariant, string> = {
  success: 'border-green-200 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-900/20 dark:text-green-300',
  error: 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-900/20 dark:text-red-300',
  warning: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-900/20 dark:text-amber-300',
  info: 'border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-900 dark:bg-indigo-900/20 dark:text-indigo-300',
};

function AlertIcon({ variant }: { variant: AlertVariant }) {
  if (variant === 'success') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0">
        <path d="M20 6L9 17l-5-5" />
      </svg>
    );
  }
  if (variant === 'error') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0">
        <path d="M18 6L6 18M6 6l12 12" />
      </svg>
    );
  }
  if (variant === 'warning') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0">
        <path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4M12 8h.01" />
    </svg>
  );
}

export function Alert({ variant, title, children }: { variant: AlertVariant; title?: string; children: React.ReactNode }) {
  return (
    <div className={`flex gap-2 rounded-lg border px-3 py-2.5 text-sm ${VARIANT_STYLES[variant]}`}>
      <AlertIcon variant={variant} />
      <div className="min-w-0 flex-1 break-words">
        {title && <p className="font-medium">{title}</p>}
        {children}
      </div>
    </div>
  );
}

/** Bloco monoespaçado pra saída de comando (stdout/stderr), usado dentro ou perto de um Alert. */
export function CommandOutput({ children }: { children: React.ReactNode }) {
  return <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">{children}</pre>;
}
