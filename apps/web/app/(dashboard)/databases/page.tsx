'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import type { DatabaseListItem } from '@/lib/types';
import { Skeleton } from '@/components/Skeleton';
import { StatusBadge, type StatusTone } from '@/components/StatusBadge';
import { DatabaseCreateWizard } from '@/components/DatabaseCreateWizard';
import { IconDatabase, IconPlus, IconClock } from '@/components/icons';

const STATUS_TONE: Record<string, StatusTone> = {
  RUNNING: 'success',
  DEPLOYING: 'info',
  STOPPED: 'neutral',
  ERROR: 'danger',
};

function engineLabel(image: string) {
  const img = image.toLowerCase();
  if (img.includes('postgres')) return 'PostgreSQL';
  if (img.includes('mariadb')) return 'MariaDB';
  if (img.includes('mysql')) return 'MySQL';
  return image;
}

export default function DatabasesPage() {
  const [databases, setDatabases] = useState<DatabaseListItem[] | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  function load() {
    apiFetch<DatabaseListItem[]>('/databases').then(setDatabases);
  }

  useEffect(load, []);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Bancos de Dados</h1>
          <p className="text-xs text-slate-400">Postgres, MySQL e MariaDB gerenciados pelo Velix — conexão, backup e mais</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-1.5 px-4 py-2 text-sm">
          <IconPlus className="h-4 w-4" aria-hidden />
          Criar banco
        </button>
      </div>

      {!databases && <Skeleton className="h-40" />}

      {databases && databases.length === 0 && (
        <div className="card flex flex-col items-center gap-2 p-10 text-center">
          <IconDatabase className="h-8 w-8 text-slate-300 dark:text-slate-600" aria-hidden />
          <p className="text-sm text-slate-400">Nenhum banco de dados ainda.</p>
        </div>
      )}

      {databases && databases.length > 0 && (
        <div className="card divide-y divide-slate-100 overflow-hidden dark:divide-slate-700">
          {databases.map((db) => (
            <Link
              key={db.id}
              href={`/databases/${db.id}`}
              className="flex items-center justify-between gap-3 px-4 py-3.5 transition hover:bg-slate-50 dark:hover:bg-slate-800/40"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-500">
                  <IconDatabase className="h-4.5 w-4.5" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{db.project.name}</p>
                  <p className="truncate text-xs text-slate-400">
                    {engineLabel(db.image)} · {db.server.name}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {db.hasSchedule && (
                  <span title="Backup agendado">
                    <IconClock className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                  </span>
                )}
                <StatusBadge tone={STATUS_TONE[db.status] ?? 'neutral'}>{db.status}</StatusBadge>
              </div>
            </Link>
          ))}
        </div>
      )}

      {showCreate && (
        <DatabaseCreateWizard
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            load();
          }}
        />
      )}
    </div>
  );
}
