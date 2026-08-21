'use client';

import Link from 'next/link';
import type { ServerSummary } from '@/lib/types';
import { Bar } from './Bar';
import { StatusBadge, rowStatusBorderClass, SERVER_STATUS_TONE } from './StatusBadge';
import { ActionMenu, type ActionMenuItem } from './ActionMenu';
import { IconServer } from './icons';

/** Linha compacta de servidor — usada na lista de Servidores e no Dashboard,
 * pra manter as duas telas com a mesma cara em vez de dois cards diferentes. */
export function ServerRow({ server, actions }: { server: ServerSummary; actions?: ActionMenuItem[] }) {
  const memPercent =
    server.metrics?.memTotalMb && server.metrics.memUsedMb != null ? (server.metrics.memUsedMb / server.metrics.memTotalMb) * 100 : null;
  const diskPercent = server.metrics?.diskPercent ? Number(server.metrics.diskPercent.replace('%', '')) : null;

  return (
    <div
      className={`group flex items-center gap-4 border-l-[3px] ${rowStatusBorderClass(SERVER_STATUS_TONE[server.status])} py-2.5 pl-3.5 pr-4 transition hover:bg-slate-50 dark:hover:bg-slate-800/40`}
    >
      <IconServer className="h-4 w-4 shrink-0 text-slate-400" />

      <Link href={`/servers/${server.id}`} className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-sm font-medium text-slate-900 group-hover:text-indigo-600 dark:text-slate-100 dark:group-hover:text-indigo-400">
            {server.name}
          </p>
          {server.isLocal && <StatusBadge tone="info">este servidor</StatusBadge>}
        </div>
        <p className="truncate text-xs text-slate-400">
          {server.isLocal ? (
            'Onde o Velix está instalado'
          ) : (
            <span className="font-mono">{server.publicIp ?? server.privateIp ?? '—'}</span>
          )}
          {server.sshUser ? ` · ${server.sshUser}` : ''}
        </p>
      </Link>

      <div className="hidden shrink-0 items-center gap-3 text-xs text-slate-500 dark:text-slate-400 md:flex">
        <div className="flex items-center gap-1.5" title="Memória">
          <span className="w-8 shrink-0 text-slate-400 dark:text-slate-500">Mem</span>
          {memPercent !== null ? (
            <>
              <Bar percent={memPercent} />
              <span className="w-8 shrink-0 tabular-nums">{memPercent.toFixed(0)}%</span>
            </>
          ) : (
            <span className="w-8 shrink-0">—</span>
          )}
        </div>
        <div className="flex items-center gap-1.5" title="Disco">
          <span className="w-8 shrink-0 text-slate-400 dark:text-slate-500">Disco</span>
          {diskPercent !== null ? (
            <>
              <Bar percent={diskPercent} />
              <span className="w-8 shrink-0 tabular-nums">{diskPercent.toFixed(0)}%</span>
            </>
          ) : (
            <span className="w-8 shrink-0">—</span>
          )}
        </div>
        {server.metrics?.uptimeText && <span className="hidden w-24 shrink-0 truncate lg:inline">{server.metrics.uptimeText}</span>}
      </div>

      {actions && <ActionMenu items={actions} />}
    </div>
  );
}
