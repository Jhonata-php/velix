import type { ReactNode } from 'react';
import { IconServer } from './icons';
import { StatusBadge, SERVER_STATUS_TONE } from './StatusBadge';
import { ActionMenu, type ActionMenuItem } from './ActionMenu';

/** Cabeçalho de entidade — superfície própria elevada, separada do conteúdo abaixo,
 * pra dar ao servidor um ponto focal claro em vez de texto solto sobre o fundo. */
export function ServerHeader({
  name,
  status,
  meta,
  badges,
  actions,
}: {
  name: string;
  status: 'PENDING' | 'ONLINE' | 'OFFLINE' | 'ERROR';
  meta: ReactNode;
  badges?: ReactNode;
  actions: ActionMenuItem[];
}) {
  return (
    <div className="surface-elevated mb-5 p-4 md:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
            <IconServer className="h-5 w-5" />
          </span>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
            <h1 className="truncate text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{name}</h1>
            <StatusBadge tone={SERVER_STATUS_TONE[status]}>{status}</StatusBadge>
          </div>
        </div>
        <ActionMenu items={actions} />
      </div>
      <p className="mt-1.5 truncate text-sm text-slate-500 md:pl-[52px]">{meta}</p>
      {badges && <div className="mt-3 flex flex-wrap gap-2 md:pl-[52px]">{badges}</div>}
    </div>
  );
}
