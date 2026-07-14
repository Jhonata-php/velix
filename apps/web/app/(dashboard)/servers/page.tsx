'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { useAutoRefresh } from '@/lib/useAutoRefresh';
import { Alert } from '@/components/Alert';
import { ConfirmModal } from '@/components/Modal';
import { ServerFormModal } from '@/components/ServerFormModal';
import { IconPlus, IconRefresh, IconPencil, IconTrash, IconServer } from '@/components/icons';

interface Server {
  id: string;
  name: string;
  publicIp: string | null;
  privateIp: string | null;
  sshPort: number;
  sshUser: string;
  authMethod: 'PASSWORD' | 'PRIVATE_KEY';
  status: 'PENDING' | 'ONLINE' | 'OFFLINE' | 'ERROR';
}

const STATUS_STYLE: Record<Server['status'], string> = {
  ONLINE: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400',
  OFFLINE: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  ERROR: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
  PENDING: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
};

export default function ServersPage() {
  const [servers, setServers] = useState<Server[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Server | null>(null);
  const [deleting, setDeleting] = useState<Server | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function handleDelete() {
    if (!deleting) return;
    setDeleteLoading(true);
    setDeleteError(null);
    try {
      await apiFetch(`/servers/${deleting.id}`, { method: 'DELETE' });
      setDeleting(null);
      load();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Falha ao excluir servidor');
    } finally {
      setDeleteLoading(false);
    }
  }

  function load() {
    setRefreshing(true);
    apiFetch<Server[]>('/servers')
      .then(setServers)
      .catch((e) => setError(e.message))
      .finally(() => setRefreshing(false));
  }

  useEffect(load, []);
  useAutoRefresh(load, 10_000);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Servidores</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            title="Atualizar agora"
            className="btn-secondary flex items-center gap-2 px-3 py-2 text-sm"
          >
            <IconRefresh className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={() => setShowForm(true)} className="btn-primary flex items-center gap-2 px-4 py-2 text-sm">
            <IconPlus className="h-4 w-4" />
            Adicionar servidor
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4">
          <Alert variant="error">{error}</Alert>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {servers.map((s) => (
          <div key={s.id} className="card card-hover p-4">
            <div className="mb-3 flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                <IconServer className="h-4 w-4" />
              </span>
              <Link href={`/servers/${s.id}`} className="min-w-0 flex-1 truncate font-medium hover:text-indigo-600 dark:hover:text-indigo-400">
                {s.name}
              </Link>
              <span className={`badge ${STATUS_STYLE[s.status]}`}>
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
                {s.status}
              </span>
            </div>

            <p className="mb-3 truncate text-xs text-slate-500">
              {s.publicIp ?? s.privateIp ?? '—'} · {s.sshUser}
            </p>

            <div className="flex justify-end gap-1 border-t border-slate-100 pt-2 dark:border-slate-800">
              <button
                onClick={() => setEditing(s)}
                title="Editar servidor"
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                <IconPencil className="h-4 w-4" />
              </button>
              <button
                onClick={() => setDeleting(s)}
                title="Excluir servidor"
                className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
              >
                <IconTrash className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
        {servers.length === 0 && (
          <div className="card col-span-full px-4 py-10 text-center text-slate-400">Nenhum servidor cadastrado ainda.</div>
        )}
      </div>

      {showForm && (
        <ServerFormModal
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            load();
          }}
        />
      )}

      {editing && (
        <ServerFormModal
          server={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}

      {deleting && (
        <ConfirmModal
          title="Excluir servidor"
          message={`Tem certeza que quer excluir "${deleting.name}"? Isso remove o cadastro do Velix — nada é desinstalado no servidor.`}
          confirmLabel="Excluir"
          danger
          loading={deleteLoading}
          error={deleteError}
          onConfirm={handleDelete}
          onCancel={() => {
            setDeleting(null);
            setDeleteError(null);
          }}
        />
      )}
    </div>
  );
}

