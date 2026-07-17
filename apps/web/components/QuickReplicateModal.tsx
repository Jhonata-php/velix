'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { Modal } from '@/components/Modal';
import type { DatabaseInstanceSummary } from '@/lib/types';

export function QuickReplicateModal({
  instance,
  currentServerId,
  onClose,
  onCreated,
}: {
  instance: DatabaseInstanceSummary;
  currentServerId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [servers, setServers] = useState<{ id: string; name: string; dockerInstalled: boolean }[]>([]);
  const [targetServerId, setTargetServerId] = useState('');
  const [name, setName] = useState(`${instance.name}-replica`);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[] | null>(null);

  useEffect(() => {
    apiFetch<{ id: string; name: string; dockerInstalled: boolean }[]>('/servers').then((all) =>
      setServers(all.filter((s) => s.id !== currentServerId)),
    );
  }, [currentServerId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch<{ warnings: string[] }>(`/databases/${instance.id}/replicate`, {
        method: 'POST',
        body: JSON.stringify({ targetServerId, name }),
      });
      setWarnings(res.warnings);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao criar réplica');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={warnings ? 'Réplica criada' : `Replicar "${instance.name}"`} onClose={warnings ? onCreated : onClose} closeDisabled={saving}>
      {warnings ? (
        <div>
          {warnings.map((w) => (
            <p key={w} className="mb-2 text-sm text-amber-600 dark:text-amber-400">
              ⚠️ {w}
            </p>
          ))}
          <button onClick={onCreated} className="mt-2 w-full btn-primary px-4 py-2 text-sm">
            Fechar
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <label className="mb-3 block text-sm">
            <span className="mb-1 block font-medium">Servidor de destino</span>
            <select required value={targetServerId} onChange={(e) => setTargetServerId(e.target.value)} className="input">
              <option value="">Selecione...</option>
              {servers.map((s) => (
                <option key={s.id} value={s.id} disabled={!s.dockerInstalled}>
                  {s.name} {!s.dockerInstalled ? '(sem Docker)' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="mb-3 block text-sm">
            <span className="mb-1 block font-medium">Nome da réplica</span>
            <input required value={name} onChange={(e) => setName(e.target.value)} className="input" />
          </label>
          {error && <p className="mb-3 text-sm text-red-500">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="btn-primary px-4 py-2 text-sm">
              {saving ? 'Criando...' : 'Criar réplica'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
