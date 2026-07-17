import type { ReactNode } from 'react';

export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const TONE_BADGE: Record<StatusTone, string> = {
  success: 'bg-green-500/10 text-green-600 dark:text-green-400',
  warning: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  danger: 'bg-red-500/10 text-red-600 dark:text-red-400',
  info: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  neutral: 'bg-slate-500/10 text-slate-500 dark:text-slate-400',
};

const TONE_DOT: Record<StatusTone, string> = {
  success: 'bg-green-500',
  warning: 'bg-amber-400',
  danger: 'bg-red-500',
  info: 'bg-sky-400',
  neutral: 'bg-slate-400',
};

export function StatusDot({ tone, className = 'h-1.5 w-1.5' }: { tone: StatusTone; className?: string }) {
  return <span className={`shrink-0 rounded-full ${TONE_DOT[tone]} ${className}`} />;
}

export function StatusBadge({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return (
    <span className={`badge ${TONE_BADGE[tone]}`}>
      <StatusDot tone={tone} />
      {children}
    </span>
  );
}

/** Badge simples "ok / não ok" (ex.: Docker instalado), reaproveitando os mesmos tons. */
export function CapabilityBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`badge border ${ok ? 'border-green-200 dark:border-green-900' : 'border-slate-200 dark:border-slate-700'} ${TONE_BADGE[ok ? 'success' : 'neutral']}`}>
      <StatusDot tone={ok ? 'success' : 'neutral'} />
      {label}
    </span>
  );
}

export const SERVER_STATUS_TONE: Record<'PENDING' | 'ONLINE' | 'OFFLINE' | 'ERROR', StatusTone> = {
  ONLINE: 'success',
  OFFLINE: 'neutral',
  ERROR: 'danger',
  PENDING: 'warning',
};

export const REPLICATION_STATUS_TONE: Record<string, StatusTone> = {
  PROVISIONING: 'neutral',
  SYNCING: 'warning',
  IN_SYNC: 'success',
  DELAYED: 'warning',
  ERROR: 'danger',
  PROMOTED: 'info',
};

export const INSTANCE_STATUS_TONE: Record<string, StatusTone> = {
  ONLINE: 'success',
  OFFLINE: 'neutral',
  ERROR: 'danger',
};
