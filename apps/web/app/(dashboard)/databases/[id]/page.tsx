'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';

interface Replication {
  id: string;
  status: 'PROVISIONING' | 'SYNCING' | 'IN_SYNC' | 'DELAYED' | 'ERROR' | 'PROMOTED';
  secondsBehind: number | null;
  lastError: string | null;
  lastCheckedAt: string | null;
}

interface DatabaseInstanceDetail {
  id: string;
  name: string;
  serverId: string;
  engine: string;
  port: number;
  role: 'STANDALONE' | 'PRIMARY' | 'REPLICA';
  status: string;
  databaseName: string;
  appUser: string;
  version: string | null;
  replicationsAsPrimary: Replication[];
  replicationAsReplica: Replication | null;
}

interface ServerOption {
  id: string;
  name: string;
  dockerInstalled: boolean;
}

const STATUS_LABEL: Record<Replication['status'], string> = {
  PROVISIONING: 'provisionando',
  SYNCING: 'sincronizando',
  IN_SYNC: 'sincronizado',
  DELAYED: 'atrasado',
  ERROR: 'com erro',
  PROMOTED: 'promovida (antiga réplica agora é primário)',
};

export default function DatabaseDetailPage() {
  const params = useParams<{ id: string }>();
  const [instance, setInstance] = useState<DatabaseInstanceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    apiFetch<DatabaseInstanceDetail>(`/databases/${params.id}`)
      .then(setInstance)
      .catch((e) => setError(e.message));
  }

  useEffect(load, [params.id]);

  if (error) return <p className="text-sm text-red-500">{error}</p>;
  if (!instance) return null;

  return (
    <div className="max-w-2xl">
      <h1 className="mb-1 text-xl font-semibold">{instance.name}</h1>
      <p className="mb-6 text-sm text-slate-500">
        MySQL {instance.version ?? ''} · porta {instance.port} · banco {instance.databaseName}
      </p>

      <div className="mb-8 grid grid-cols-2 gap-4 rounded-xl border border-slate-200 p-4 text-sm dark:border-slate-800">
        <Info label="Papel" value={instance.role} />
        <Info label="Status" value={instance.status} />
      </div>

      {instance.role !== 'REPLICA' && (
        <ReplicaSection instanceId={instance.id} replications={instance.replicationsAsPrimary} onChange={load} />
      )}

      {instance.replicationAsReplica && (
        <ReplicationCard replication={instance.replicationAsReplica} isReplicaSide onChange={load} />
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-slate-500">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}

function ReplicaSection({
  instanceId,
  replications,
  onChange,
}: {
  instanceId: string;
  replications: Replication[];
  onChange: () => void;
}) {
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="mb-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-medium">Réplicas</h2>
        <button
          onClick={() => setShowForm(true)}
          className="btn-secondary px-3 py-1.5 text-sm"
        >
          Criar réplica
        </button>
      </div>

      {replications.length === 0 && <p className="text-sm text-slate-400">Nenhuma réplica configurada.</p>}
      {replications.map((r) => (
        <ReplicationCard key={r.id} replication={r} onChange={onChange} />
      ))}

      {showForm && (
        <CreateReplicaModal
          instanceId={instanceId}
          onClose={() => setShowForm(false)}
          onCreated={() => {
            setShowForm(false);
            onChange();
          }}
        />
      )}
    </div>
  );
}

function ReplicationCard({
  replication,
  isReplicaSide,
  onChange,
}: {
  replication: Replication;
  isReplicaSide?: boolean;
  onChange: () => void;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  async function refresh() {
    setRefreshing(true);
    try {
      await apiFetch(`/replications/${replication.id}`);
      onChange();
    } finally {
      setRefreshing(false);
    }
  }

  async function handlePromote() {
    setPromoting(true);
    setError(null);
    try {
      const res = await apiFetch<{ ok: boolean; warnings: string[] }>(`/replications/${replication.id}/promote`, {
        method: 'POST',
        body: JSON.stringify({ confirm: true }),
      });
      setWarnings(res.warnings);
      setShowConfirm(false);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao promover réplica');
    } finally {
      setPromoting(false);
    }
  }

  const statusColor =
    replication.status === 'IN_SYNC'
      ? 'text-green-600 dark:text-green-400'
      : replication.status === 'PROMOTED'
        ? 'text-blue-600 dark:text-blue-400'
        : replication.status === 'DELAYED'
          ? 'text-amber-600 dark:text-amber-400'
          : 'text-red-500';

  return (
    <div className="mb-3 rounded-xl border border-slate-200 p-4 text-sm dark:border-slate-800">
      <div className="mb-2 flex items-center justify-between">
        <span className={`font-medium ${statusColor}`}>{STATUS_LABEL[replication.status]}</span>
        <button onClick={refresh} disabled={refreshing} className="text-xs text-slate-400 hover:underline">
          {refreshing ? 'Atualizando...' : 'Atualizar status'}
        </button>
      </div>
      {replication.secondsBehind !== null && <p className="text-slate-500">Atraso: {replication.secondsBehind}s</p>}
      {replication.lastError && <p className="text-red-500">{replication.lastError}</p>}
      {replication.lastCheckedAt && (
        <p className="text-xs text-slate-400">Última checagem: {new Date(replication.lastCheckedAt).toLocaleString('pt-BR')}</p>
      )}

      {!isReplicaSide && replication.status !== 'PROMOTED' && (
        <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
          {!showConfirm ? (
            <button
              onClick={() => setShowConfirm(true)}
              className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
            >
              Promover esta réplica a primário
            </button>
          ) : (
            <div>
              <p className="mb-2 text-amber-700 dark:text-amber-400">
                Isso torna esta réplica o novo primário e coloca o antigo primário em somente leitura (quando alcançável). Ação manual —
                confirme que você já verificou a situação real do banco.
              </p>
              <p className="mb-2 text-xs">
                Digite <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">PROMOVER</code> para confirmar:
              </p>
              <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} className="input mb-2 w-40" />
              <div className="flex gap-2">
                <button
                  onClick={() => setShowConfirm(false)}
                  className="rounded-lg px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  onClick={handlePromote}
                  disabled={confirmText !== 'PROMOVER' || promoting}
                  className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {promoting ? 'Promovendo...' : 'Confirmar promoção'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {error && <p className="mt-2 text-red-500">{error}</p>}
      {warnings.map((w) => (
        <p key={w} className="mt-2 text-amber-600 dark:text-amber-400">
          ⚠️ {w}
        </p>
      ))}
    </div>
  );
}

function CreateReplicaModal({ instanceId, onClose, onCreated }: { instanceId: string; onClose: () => void; onCreated: () => void }) {
  const [servers, setServers] = useState<ServerOption[]>([]);
  const [form, setForm] = useState({ targetServerId: '', name: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[] | null>(null);

  useEffect(() => {
    apiFetch<ServerOption[]>('/servers').then(setServers);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch<{ warnings: string[] }>(`/databases/${instanceId}/replicate`, {
        method: 'POST',
        body: JSON.stringify(form),
      });
      setWarnings(res.warnings);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao criar réplica');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-lg dark:border-slate-800 dark:bg-slate-900">
        {warnings ? (
          <div>
            <h2 className="mb-3 text-lg font-semibold">Réplica criada</h2>
            {warnings.map((w) => (
              <p key={w} className="mb-2 text-sm text-amber-600 dark:text-amber-400">
                ⚠️ {w}
              </p>
            ))}
            <button
              onClick={onCreated}
              className="mt-2 w-full btn-primary px-4 py-2 text-sm"
            >
              Fechar
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <h2 className="mb-4 text-lg font-semibold">Criar réplica</h2>
            <label className="mb-3 block text-sm">
              <span className="mb-1 block font-medium">Servidor de destino</span>
              <select
                required
                value={form.targetServerId}
                onChange={(e) => setForm({ ...form, targetServerId: e.target.value })}
                className="input"
              >
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
              <input required placeholder="ex: replica-1" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input" />
            </label>
            {error && <p className="mb-3 text-sm text-red-500">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="btn-primary px-4 py-2 text-sm"
              >
                {saving ? 'Criando (dump + cópia, pode levar minutos)...' : 'Criar réplica'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
