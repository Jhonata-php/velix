'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useAutoRefresh } from '@/lib/useAutoRefresh';
import type { ServerSummary } from '@/lib/types';
import { Alert } from '@/components/Alert';
import { ConfirmModal } from '@/components/Modal';
import { ServerFormModal } from '@/components/ServerFormModal';
import { AddServerWizard } from '@/components/AddServerWizard';
import { ServerRow } from '@/components/ServerRow';
import { EmptyState } from '@/components/EmptyState';
import { SkeletonRow } from '@/components/Skeleton';
import type { ActionMenuItem } from '@/components/ActionMenu';
import { IconPlus, IconRefresh, IconPencil, IconTrash, IconInbox } from '@/components/icons';

export default function ServersPage() {
  const [servers, setServers] = useState<ServerSummary[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ServerSummary | null>(null);
  const [deleting, setDeleting] = useState<ServerSummary | null>(null);
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
    apiFetch<ServerSummary[]>('/servers')
      .then(setServers)
      .catch((e) => setError(e.message))
      .finally(() => setRefreshing(false));
  }

  useEffect(load, []);
  useAutoRefresh(load, 10_000);

  function actionsFor(s: ServerSummary): ActionMenuItem[] {
    // O servidor local não é editável nem removível: a credencial dele é
    // regravada pelo instalador a cada start da API, e excluir só o faria
    // voltar na próxima subida (ver LocalServerService no backend).
    if (s.isLocal) return [];
    return [
      { label: 'Editar servidor', icon: <IconPencil className="h-4 w-4" />, onClick: () => setEditing(s) },
      { label: 'Excluir servidor', icon: <IconTrash className="h-4 w-4" />, onClick: () => setDeleting(s), danger: true },
    ];
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="page-title">Servidores</h1>
          <p className="text-xs text-slate-400">Cadastro e monitoramento por SSH</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} title="Atualizar agora" className="btn-secondary flex items-center gap-2 px-3 py-2 text-sm">
            <IconRefresh className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={() => setShowForm(true)} className="btn-primary flex items-center gap-2 px-3.5 py-2 text-sm">
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

      {servers === null ? (
        <div className="card divide-y divide-slate-100 overflow-hidden dark:divide-slate-700">
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </div>
      ) : servers.length === 0 ? (
        <EmptyState
          icon={<IconInbox className="h-5 w-5" />}
          title="Nenhum servidor cadastrado ainda"
          description="Adicione um servidor Linux via SSH para começar a monitorar e gerenciar sua infraestrutura."
          action={
            <button onClick={() => setShowForm(true)} className="btn-primary flex items-center gap-2 px-3.5 py-2 text-sm">
              <IconPlus className="h-4 w-4" />
              Adicionar servidor
            </button>
          }
        />
      ) : (
        <div className="card divide-y divide-slate-100 overflow-hidden dark:divide-slate-700">
          {servers.map((s) => (
            <ServerRow key={s.id} server={s} actions={actionsFor(s)} />
          ))}
        </div>
      )}

      {/* Criar passa pelo assistente (dados -> conexão -> preparação); editar
          continua no formulário simples, porque ali não há nada a instalar. */}
      {showForm && (
        <AddServerWizard
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
