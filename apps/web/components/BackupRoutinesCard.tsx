'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { relativeTime } from '@/lib/relativeTime';
import type { DatabaseBackupRoutine, DatabaseListItem, BackupDestinationSummary } from '@/lib/types';
import { Alert } from './Alert';
import { Modal, ConfirmModal } from './Modal';
import { StatusBadge } from './StatusBadge';
import { IconPlus, IconPencil, IconTrash, IconDatabase } from './icons';

/**
 * Rotinas de backup dos bancos de projetos (Postgres/MySQL/MariaDB) — visão
 * central em Configurações → Backup, pra não precisar abrir banco por banco
 * (Bancos de Dados → banco → Backups) só pra ver se o agendamento está ativo.
 * Editar/remover aqui grava na mesma `DatabaseBackupConfig` de lá — as duas
 * telas sempre mostram o mesmo estado.
 */
export function BackupRoutinesCard() {
  const [routines, setRoutines] = useState<DatabaseBackupRoutine[] | null>(null);
  const [databases, setDatabases] = useState<DatabaseListItem[]>([]);
  const [destinations, setDestinations] = useState<BackupDestinationSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<DatabaseBackupRoutine | 'new' | null>(null);
  const [removing, setRemoving] = useState<DatabaseBackupRoutine | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  function load() {
    apiFetch<DatabaseBackupRoutine[]>('/databases/backup-routines')
      .then(setRoutines)
      .catch((e) => setError(e instanceof Error ? e.message : 'Falha ao carregar'));
    apiFetch<DatabaseListItem[]>('/databases').then(setDatabases).catch(() => undefined);
    apiFetch<BackupDestinationSummary[]>('/backup-destinations').then(setDestinations).catch(() => undefined);
  }

  useEffect(load, []);

  async function handleRemove() {
    if (!removing) return;
    setRemoveBusy(true);
    try {
      await apiFetch(`/databases/${removing.id}/backup-config`, { method: 'PATCH', body: JSON.stringify({ scheduledAt: null }) });
      setRemoving(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao remover a rotina');
    } finally {
      setRemoveBusy(false);
    }
  }

  return (
    <div className="card space-y-4 p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="section-title">Rotinas de backup</p>
          <p className="text-xs text-slate-400">Agendamento de backup dos bancos de dados dos seus projetos</p>
        </div>
        <button onClick={() => setEditing('new')} className="btn-secondary flex items-center gap-1.5 px-3.5 py-2 text-sm">
          <IconPlus className="h-4 w-4" aria-hidden />
          Adicionar rotina
        </button>
      </div>

      {error && <Alert variant="error">{error}</Alert>}

      {routines === null && <p className="text-sm text-slate-400">Carregando...</p>}
      {routines?.length === 0 && <p className="text-sm text-slate-400">Nenhuma rotina configurada ainda.</p>}

      {routines && routines.length > 0 && (
        <div className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
          {routines.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
              <div className="flex min-w-0 items-center gap-2.5">
                <IconDatabase className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">
                    {r.name} <span className="font-normal text-slate-400">· {r.project.name}</span>
                  </p>
                  <p className="truncate text-xs text-slate-400">
                    {r.scheduledAt} · {r.retentionDays}d · {r.destination ? r.destination.label : 'só neste servidor'}
                    {r.lastRun && ` · último ${relativeTime(r.lastRun.startedAt)}`}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {r.lastRun && (
                  <StatusBadge tone={r.lastRun.status === 'SUCCESS' ? 'success' : r.lastRun.status === 'ERROR' ? 'danger' : 'info'}>
                    {r.lastRun.status === 'SUCCESS' ? 'concluído' : r.lastRun.status === 'ERROR' ? 'falhou' : 'rodando'}
                  </StatusBadge>
                )}
                <button onClick={() => setEditing(r)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200" aria-label="Editar rotina">
                  <IconPencil className="h-4 w-4" aria-hidden />
                </button>
                <button onClick={() => setRemoving(r)} className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10" aria-label="Remover rotina">
                  <IconTrash className="h-4 w-4" aria-hidden />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <RoutineModal
          routine={editing === 'new' ? null : editing}
          databases={databases}
          destinations={destinations}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}

      {removing && (
        <ConfirmModal
          title="Remover rotina"
          message={`Remover a rotina de backup de "${removing.name}"? O agendamento automático desse banco é desligado — backup manual continua disponível.`}
          confirmLabel="Remover"
          danger
          loading={removeBusy}
          onConfirm={handleRemove}
          onCancel={() => setRemoving(null)}
        />
      )}
    </div>
  );
}

function RoutineModal({
  routine,
  databases,
  destinations,
  onClose,
  onSaved,
}: {
  routine: DatabaseBackupRoutine | null;
  databases: DatabaseListItem[];
  destinations: BackupDestinationSummary[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(routine ? [routine.id] : []));
  const [scheduledAt, setScheduledAt] = useState(routine?.scheduledAt ?? '03:00');
  const [retentionDays, setRetentionDays] = useState(routine?.retentionDays ?? 14);
  const [destinationId, setDestinationId] = useState(routine?.destination?.id ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allSelected = databases.length > 0 && selected.size === databases.length;

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(databases.map((d) => d.id)));
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSave() {
    if (selected.size === 0) {
      setError('Selecione ao menos um banco de dados.');
      return;
    }
    if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 365) {
      setError('Retenção precisa ser um número inteiro entre 1 e 365 dias.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiFetch('/databases/backup-routines', {
        method: 'PATCH',
        body: JSON.stringify({
          projectServiceIds: Array.from(selected),
          scheduledAt,
          retentionDays,
          destinationId: destinationId || null,
        }),
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao salvar a rotina');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={routine ? 'Editar rotina' : 'Nova rotina de backup'} onClose={onClose} closeDisabled={saving} maxWidth="max-w-lg">
      <div className="space-y-4">
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Bancos de dados</span>
            {databases.length > 0 && (
              <button type="button" onClick={toggleAll} className="text-xs text-indigo-600 hover:underline dark:text-indigo-400">
                {allSelected ? 'Desmarcar todos' : 'Selecionar todos'}
              </button>
            )}
          </div>
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2 dark:border-slate-700">
            {databases.length === 0 && <p className="p-1 text-sm text-slate-400">Nenhum banco de dados encontrado.</p>}
            {databases.map((d) => (
              <label key={d.id} className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-slate-50 dark:hover:bg-slate-800">
                <input type="checkbox" checked={selected.has(d.id)} onChange={() => toggleOne(d.id)} className="h-4 w-4 rounded border-slate-300" />
                <span className="min-w-0 truncate">
                  {d.name} <span className="text-slate-400">· {d.project.name}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-slate-700 dark:text-slate-200">Horário diário</span>
            <input type="time" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className="input" required />
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-slate-700 dark:text-slate-200">Retenção (dias)</span>
            <input type="number" min={1} max={365} value={retentionDays} onChange={(e) => setRetentionDays(Number(e.target.value))} className="input" required />
          </label>
        </div>

        <label className="block text-sm">
          <span className="mb-1.5 block font-medium text-slate-700 dark:text-slate-200">Destino remoto (opcional)</span>
          <select value={destinationId} onChange={(e) => setDestinationId(e.target.value)} className="input">
            <option value="">Só neste servidor</option>
            {destinations.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label} ({d.protocol.toUpperCase()})
              </option>
            ))}
          </select>
        </label>

        {error && <Alert variant="error">{error}</Alert>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="btn-secondary px-3.5 py-2 text-sm">
            Cancelar
          </button>
          <button type="button" onClick={handleSave} disabled={saving} className="btn-primary px-3.5 py-2 text-sm disabled:opacity-50">
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
