'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { Modal } from '@/components/Modal';
import { Alert } from '@/components/Alert';
import type { DockerContainer } from '@/lib/containerGroups';
import type { DatabaseInstanceSummary } from '@/lib/types';

export function BulkCloneGroupModal({
  sourceServerId,
  group,
  instances,
  onClose,
}: {
  sourceServerId: string;
  group: { key: string; containers: DockerContainer[] };
  instances: DatabaseInstanceSummary[];
  onClose: () => void;
}) {
  const [servers, setServers] = useState<{ id: string; name: string; dockerInstalled: boolean }[]>([]);
  const [targetServerId, setTargetServerId] = useState('');
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<{ name: string; ok: boolean; message: string }[]>([]);

  useEffect(() => {
    apiFetch<{ id: string; name: string; dockerInstalled: boolean }[]>('/servers').then((all) =>
      setServers(all.filter((s) => s.id !== sourceServerId)),
    );
  }, [sourceServerId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setRunning(true);
    setResults([]);
    for (const c of group.containers) {
      const instance = instances.find((i) => i.containerName === c.names);
      try {
        if (instance && instance.role !== 'REPLICA') {
          await apiFetch(`/databases/${instance.id}/replicate`, {
            method: 'POST',
            body: JSON.stringify({ targetServerId, name: `${instance.name}-replica` }),
          });
          setResults((r) => [...r, { name: c.names, ok: true, message: 'Réplica de banco criada' }]);
        } else if (!instance) {
          await apiFetch(`/servers/${sourceServerId}/docker/containers/${c.id}/clone`, {
            method: 'POST',
            body: JSON.stringify({ targetServerId }),
          });
          setResults((r) => [...r, { name: c.names, ok: true, message: 'Container clonado' }]);
        } else {
          setResults((r) => [...r, { name: c.names, ok: false, message: 'Já é uma réplica — pulado' }]);
        }
      } catch (err) {
        setResults((r) => [...r, { name: c.names, ok: false, message: err instanceof Error ? err.message : 'Falha' }]);
      }
    }
    setRunning(false);
  }

  const done = results.length === group.containers.length && results.length > 0;

  return (
    <Modal title={`Clonar tudo em "${group.key}"`} onClose={onClose} closeDisabled={running} maxWidth="max-w-lg">
      {!running && results.length === 0 && (
        <form onSubmit={handleSubmit}>
          <div className="mb-3">
            <Alert variant="info">
              Envia {group.containers.length} container(s) pro servidor escolhido: bancos MySQL do Velix viram réplica de verdade (com
              sincronização), os demais são clonados (imagem + config, sem sincronizar dados). Cada um pode levar minutos.
            </Alert>
          </div>
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
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
              Cancelar
            </button>
            <button type="submit" className="btn-primary px-4 py-2 text-sm">
              Iniciar
            </button>
          </div>
        </form>
      )}

      {(running || results.length > 0) && (
        <div>
          <div className="mb-3 space-y-1.5">
            {group.containers.map((c) => {
              const result = results.find((r) => r.name === c.names);
              return (
                <div key={c.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700">
                  <span className="truncate">{c.names}</span>
                  {!result ? (
                    <span className="shrink-0 text-xs text-slate-400">{running ? 'aguardando...' : '—'}</span>
                  ) : (
                    <span className={`shrink-0 text-xs ${result.ok ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
                      {result.message}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          {done && (
            <button onClick={onClose} className="w-full btn-primary px-4 py-2 text-sm">
              Fechar
            </button>
          )}
        </div>
      )}
    </Modal>
  );
}
