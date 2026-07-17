'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { Modal } from '@/components/Modal';
import { Alert } from '@/components/Alert';
import type { DockerContainer } from '@/lib/containerGroups';

export function CloneContainerModal({
  sourceServerId,
  container,
  onClose,
  onCloned,
}: {
  sourceServerId: string;
  container: DockerContainer;
  onClose: () => void;
  onCloned: () => void;
}) {
  const [servers, setServers] = useState<{ id: string; name: string; dockerInstalled: boolean }[]>([]);
  const [targetServerId, setTargetServerId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ containerName: string } | null>(null);

  useEffect(() => {
    apiFetch<{ id: string; name: string; dockerInstalled: boolean }[]>('/servers').then((all) =>
      setServers(all.filter((s) => s.id !== sourceServerId)),
    );
  }, [sourceServerId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch<{ ok: boolean; containerName: string }>(
        `/servers/${sourceServerId}/docker/containers/${container.id}/clone`,
        { method: 'POST', body: JSON.stringify({ targetServerId }) },
      );
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao clonar container');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={result ? 'Container clonado' : `Clonar "${container.names}"`} onClose={result ? onCloned : onClose} closeDisabled={saving}>
      {result ? (
        <div>
          <Alert variant="success">
            Container criado como <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">{result.containerName}</code> no servidor de
            destino.
          </Alert>
          <button onClick={onCloned} className="mt-4 w-full btn-primary px-4 py-2 text-sm">
            Fechar
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <div className="mb-3">
            <Alert variant="info">
              Cria uma cópia com a mesma imagem, variáveis de ambiente e portas — sem sincronizar dados. Se o container usa volume/rede
              customizada (ex.: gerido pelo EasyPanel), pode precisar de ajuste manual depois.
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
          {error && <p className="mb-3 text-sm text-red-500">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="btn-primary px-4 py-2 text-sm">
              {saving ? 'Clonando...' : 'Clonar container'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
