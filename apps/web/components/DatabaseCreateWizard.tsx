'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import type { ServerSummary } from '@/lib/types';
import { Modal } from './Modal';
import { Alert } from './Alert';
import { InstallLogModal } from './InstallLogModal';

const ENGINES = [
  { slug: 'postgresql', label: 'PostgreSQL', version: '16.4' },
  { slug: 'mysql', label: 'MySQL', version: '8.4' },
  { slug: 'mariadb', label: 'MariaDB', version: '11.4' },
] as const;

/**
 * Assistente curto pra criar um banco — sem o usuário nunca ver a palavra
 * "projeto": escolhe motor, nome, servidor, e o Velix cria o projeto por
 * baixo dos panos sozinho (mesma chamada que o catálogo já faz hoje pra
 * qualquer app: POST /applications + op "service-deploy").
 */
export function DatabaseCreateWizard({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [engine, setEngine] = useState<(typeof ENGINES)[number]['slug']>('postgresql');
  const [name, setName] = useState('');
  const [servers, setServers] = useState<ServerSummary[] | null>(null);
  const [serverId, setServerId] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applicationId, setApplicationId] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<ServerSummary[]>('/servers').then((list) => {
      setServers(list);
      const recommended = list.find((s) => s.dockerInstalled);
      if (recommended) setServerId(recommended.id);
    });
  }, []);

  const selectedServer = servers?.find((s) => s.id === serverId) ?? null;
  const valid = name.trim().length >= 2 && !!selectedServer?.dockerInstalled;

  async function create() {
    if (!valid) return;
    setCreating(true);
    setError(null);
    try {
      const app = await apiFetch<{ id: string }>('/applications', {
        method: 'POST',
        body: JSON.stringify({ serverId, name: name.trim() }),
      });
      setApplicationId(app.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao criar o banco');
      setCreating(false);
    }
  }

  if (applicationId) {
    return (
      <InstallLogModal
        serverId={serverId}
        op="service-deploy"
        params={{ applicationId, manifestSlug: engine }}
        title={`Criando banco ${name}`}
        onClose={onClose}
        onDone={(ok) => {
          if (ok) onCreated();
        }}
      />
    );
  }

  return (
    <Modal title="Criar banco" onClose={creating ? undefined : onClose}>
      <div className="space-y-4">
        <div>
          <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">Motor</span>
          <div className="grid grid-cols-3 gap-2">
            {ENGINES.map((e) => (
              <button
                key={e.slug}
                type="button"
                onClick={() => setEngine(e.slug)}
                className={`rounded-lg border px-3 py-2.5 text-sm transition ${
                  engine === e.slug
                    ? 'border-indigo-500 bg-indigo-500/10 font-medium text-indigo-600 dark:text-indigo-400'
                    : 'border-slate-200 text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:text-slate-300'
                }`}
              >
                {e.label}
                <span className="mt-0.5 block text-[11px] font-normal text-slate-400">v{e.version}</span>
              </button>
            ))}
          </div>
        </div>

        <label className="block text-sm">
          <span className="mb-1.5 block font-medium text-slate-700 dark:text-slate-200">Nome</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ex.: banco-do-app" className="input" />
        </label>

        <label className="block text-sm">
          <span className="mb-1.5 block font-medium text-slate-700 dark:text-slate-200">Servidor</span>
          <select value={serverId} onChange={(e) => setServerId(e.target.value)} className="input">
            {!servers && <option>Carregando...</option>}
            {servers?.map((s) => (
              <option key={s.id} value={s.id} disabled={!s.dockerInstalled}>
                {s.name}
                {!s.dockerInstalled ? ' (sem Docker)' : ''}
              </option>
            ))}
          </select>
        </label>

        {error && <Alert variant="error">{error}</Alert>}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary px-4 py-2 text-sm">
            Cancelar
          </button>
          <button onClick={create} disabled={!valid || creating} className="btn-primary px-4 py-2 text-sm disabled:opacity-50">
            {creating ? 'Criando...' : 'Criar'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
