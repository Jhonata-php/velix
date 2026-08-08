'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import type { ServerSummary } from '@/lib/types';
import { Alert } from './Alert';
import { Modal } from './Modal';
import { Skeleton } from './Skeleton';

/** Projeto vazio — só nome + servidor. Os serviços entram depois, um a um,
 * de dentro do próprio projeto. Compartilhado entre a listagem geral de
 * Projetos e a aba Projetos de cada servidor (que já sabe o servidor). */
export function CreateProjectModal({
  defaultServerId,
  onClose,
  onCreated,
}: {
  defaultServerId?: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [servers, setServers] = useState<ServerSummary[] | null>(defaultServerId ? [] : null);
  const [name, setName] = useState('');
  const [serverId, setServerId] = useState(defaultServerId ?? '');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (defaultServerId) return;
    apiFetch<ServerSummary[]>('/servers').then((list) => {
      setServers(list);
      const recommended = list.find((s) => s.status === 'ONLINE' && s.dockerInstalled);
      if (recommended) setServerId(recommended.id);
    });
  }, [defaultServerId]);

  const valid = name.trim().length >= 2 && !!serverId;

  async function create() {
    if (!valid) return;
    setSaving(true);
    setError(null);
    try {
      const project = await apiFetch<{ id: string }>('/applications', {
        method: 'POST',
        body: JSON.stringify({ serverId, name: name.trim(), description: description.trim() || undefined }),
      });
      onCreated(project.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao criar o projeto');
      setSaving(false);
    }
  }

  return (
    <Modal title="Novo projeto" onClose={onClose} maxWidth="max-w-md">
      <div className="space-y-4">
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium text-slate-700 dark:text-slate-200">Nome</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className="input" placeholder="ex.: meu-app" />
        </label>

        {!defaultServerId && (
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-slate-700 dark:text-slate-200">Servidor</span>
            {servers === null ? (
              <Skeleton className="h-9" />
            ) : servers.length === 0 ? (
              <p className="text-xs text-slate-400">Nenhum servidor cadastrado — adicione um servidor primeiro.</p>
            ) : (
              <select value={serverId} onChange={(e) => setServerId(e.target.value)} className="input">
                {servers.map((s) => (
                  <option key={s.id} value={s.id} disabled={!s.dockerInstalled}>
                    {s.name} {s.dockerInstalled ? '' : '(sem Docker)'}
                  </option>
                ))}
              </select>
            )}
          </label>
        )}

        <label className="block text-sm">
          <span className="mb-1.5 block font-medium text-slate-700 dark:text-slate-200">Descrição (opcional)</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="input resize-none" />
        </label>

        {error && <Alert variant="error">{error}</Alert>}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary px-4 py-2 text-sm">
            Cancelar
          </button>
          <button onClick={create} disabled={!valid || saving} className="btn-primary px-4 py-2 text-sm disabled:opacity-50">
            {saving ? 'Criando...' : 'Criar e entrar'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
