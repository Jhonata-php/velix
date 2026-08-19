'use client';

import { avatarColor } from '@/lib/containerGroups';
import type { DockerContainer } from '@/lib/containerGroups';
import { IconRefresh, IconCopy, IconPower, IconTrash, IconFileText } from '@/components/icons';
import { rowStatusBorderClass } from './StatusBadge';

export function ContainerCard({
  container: c,
  label,
  canReplicate,
  isReplica,
  busy,
  onLogs,
  onReplicate,
  onClone,
  onToggle,
  onRemove,
}: {
  container: DockerContainer;
  label: string;
  canReplicate: boolean;
  isReplica: boolean;
  busy: boolean;
  onLogs: () => void;
  onReplicate: () => void;
  onClone: () => void;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const running = c.status.toLowerCase().includes('up');
  return (
    <div
      className={`group flex items-center gap-4 border-l-[3px] ${rowStatusBorderClass(running ? 'success' : 'neutral')} py-3 pl-3.5 pr-4 transition hover:bg-slate-50 dark:hover:bg-slate-800/40`}
    >
      <span className={`icon-chip shrink-0 text-sm font-semibold ${avatarColor(label)}`}>{label.slice(0, 2).toUpperCase()}</span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100" title={label}>
            {label}
          </p>
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${running ? 'bg-green-500' : 'bg-slate-400'}`} title={running ? 'Ativo' : 'Parado'} />
        </div>
        <p className="truncate font-mono text-xs text-slate-400" title={c.image}>
          {c.image}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-0.5 opacity-60 transition group-hover:opacity-100">
        <button onClick={onLogs} title="Ver logs" className="rounded-lg p-2 text-slate-400 hover:bg-slate-200/60 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200">
          <IconFileText className="h-4 w-4" />
        </button>
        {canReplicate ? (
          <button
            onClick={() => !isReplica && onReplicate()}
            disabled={isReplica}
            title={isReplica ? 'Já é uma réplica — não pode virar origem de outra' : 'Configurar replicação'}
            className="rounded-lg p-2 text-slate-400 hover:bg-indigo-100 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400 dark:hover:bg-indigo-500/15 dark:hover:text-indigo-400"
          >
            <IconRefresh className="h-4 w-4" />
          </button>
        ) : (
          <button
            onClick={onClone}
            title="Clonar container em outro servidor (sem sincronizar dados)"
            className="rounded-lg p-2 text-slate-400 hover:bg-indigo-100 hover:text-indigo-600 dark:hover:bg-indigo-500/15 dark:hover:text-indigo-400"
          >
            <IconCopy className="h-4 w-4" />
          </button>
        )}
        <button
          onClick={onToggle}
          disabled={busy}
          title={running ? 'Parar' : 'Iniciar'}
          className={`rounded-lg p-2 disabled:opacity-40 ${running ? 'text-green-600 hover:bg-green-100 dark:text-green-400 dark:hover:bg-green-500/15' : 'text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-700'}`}
        >
          <IconPower className="h-4 w-4" />
        </button>
        <button
          onClick={onRemove}
          disabled={busy}
          title="Remover"
          className="rounded-lg p-2 text-slate-400 hover:bg-red-100 hover:text-red-600 disabled:opacity-40 dark:hover:bg-red-500/15 dark:hover:text-red-400"
        >
          <IconTrash className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
