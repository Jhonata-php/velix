'use client';

import { useState } from 'react';
import { avatarColor } from '@/lib/containerGroups';
import type { DockerContainer } from '@/lib/containerGroups';
import { RowStatusLabel, rowStatusBorderClass } from './StatusBadge';
import { ActionMenu, type ActionMenuItem } from './ActionMenu';
import { IconFileText, IconChevronDown, IconRefresh, IconPower, IconCopy, IconTrash } from './icons';

/** Linha operacional de container — nome/imagem agrupados, status com o texto bruto
 * do `docker ps` (única fonte real de uptime/health hoje), ação primária + menu.
 * Expansível pra mostrar id/imagem completa sem sair da tela. */
export function ContainerRow({
  container: c,
  label,
  canReplicate,
  isReplica,
  busy,
  onLogs,
  onReplicate,
  onClone,
  onToggle,
  onRestart,
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
  onRestart: () => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const running = c.status.toLowerCase().includes('up');

  const items: ActionMenuItem[] = [
    { label: 'Ver logs', icon: <IconFileText className="h-4 w-4" />, onClick: onLogs },
    ...(running ? [{ label: 'Reiniciar', icon: <IconRefresh className="h-4 w-4" />, onClick: onRestart, disabled: busy }] : []),
    { label: running ? 'Parar' : 'Iniciar', icon: <IconPower className="h-4 w-4" />, onClick: onToggle, disabled: busy },
    canReplicate
      ? { label: 'Configurar replicação', icon: <IconRefresh className="h-4 w-4" />, onClick: onReplicate, disabled: isReplica }
      : { label: 'Clonar em outro servidor', icon: <IconCopy className="h-4 w-4" />, onClick: onClone },
    { label: 'Remover', icon: <IconTrash className="h-4 w-4" />, onClick: onRemove, danger: true, disabled: busy },
  ];

  const tone = running ? 'success' : 'neutral';

  return (
    <div className="row-hover">
      <div className={`flex items-center gap-2.5 border-l-[3px] ${rowStatusBorderClass(tone)} py-2 pl-2.5 pr-3`}>
        <button
          onClick={() => setExpanded((v) => !v)}
          title={expanded ? 'Recolher detalhes' : 'Ver detalhes'}
          className="focus-ring shrink-0 rounded p-0.5 text-slate-400 transition hover:text-slate-700 dark:hover:text-slate-200"
        >
          <IconChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
        <span className={`icon-chip h-8 w-8 shrink-0 text-xs font-semibold ${avatarColor(label)}`}>{label.slice(0, 2).toUpperCase()}</span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{label}</p>
          <p className="truncate font-mono text-[11px] text-slate-400">{c.image}</p>
        </div>

        <div className="hidden shrink-0 sm:block sm:w-40">
          <RowStatusLabel tone={tone}>{running ? 'Ativo' : 'Parado'}</RowStatusLabel>
          <p className="mt-1 truncate text-[11px] text-slate-400">{c.status}</p>
        </div>

        <button
          onClick={onLogs}
          title="Ver logs"
          className="focus-ring hidden shrink-0 rounded-lg p-2 text-slate-400 transition hover:bg-slate-200/60 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200 sm:block"
        >
          <IconFileText className="h-4 w-4" />
        </button>
        <ActionMenu items={items} />
      </div>

      {expanded && (
        <div className="grid grid-cols-1 gap-x-6 gap-y-2 border-t border-slate-100 bg-slate-50/60 px-4 py-3 pl-12 text-xs dark:border-slate-800/80 dark:bg-slate-900/40 sm:grid-cols-3">
          <div>
            <p className="text-slate-400">ID do container</p>
            <p className="truncate font-mono text-slate-600 dark:text-slate-300">{c.id}</p>
          </div>
          <div>
            <p className="text-slate-400">Imagem</p>
            <p className="truncate font-mono text-slate-600 dark:text-slate-300" title={c.image}>
              {c.image}
            </p>
          </div>
          <div className="sm:hidden">
            <p className="text-slate-400">Status</p>
            <RowStatusLabel tone={tone}>{running ? 'Ativo' : 'Parado'}</RowStatusLabel>
          </div>
          <div>
            <p className="text-slate-400">Status bruto (docker ps)</p>
            <p className="text-slate-600 dark:text-slate-300">{c.status}</p>
          </div>
        </div>
      )}
    </div>
  );
}
