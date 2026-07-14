'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { Alert } from '@/components/Alert';
import { Modal } from '@/components/Modal';
import { IconPlus, IconDisk } from '@/components/icons';

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

const REPLICATION_BADGE: Record<Replication['status'], string> = {
  PROVISIONING: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  SYNCING: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
  IN_SYNC: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400',
  DELAYED: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
  ERROR: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
  PROMOTED: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-400',
};

const INSTANCE_STATUS_BADGE: Record<string, string> = {
  ONLINE: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400',
  OFFLINE: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  ERROR: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
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

  if (error) return <Alert variant="error">{error}</Alert>;
  if (!instance) return null;

  return (
    <div className="max-w-4xl">
      <div className="mb-6 flex items-center gap-3">
        <span className="icon-chip bg-teal-50 text-teal-600 dark:bg-teal-500/10 dark:text-teal-400">
          <IconDisk className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{instance.name}</h1>
          <p className="text-sm text-slate-500">
            MySQL {instance.version ?? ''} · porta {instance.port} · banco {instance.databaseName}
          </p>
        </div>
      </div>

      <div className="card mb-8 grid grid-cols-2 gap-4 p-5 text-sm">
        <Info label="Papel" value={instance.role} />
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Status</p>
          <span className={`badge mt-1 ${INSTANCE_STATUS_BADGE[instance.status] ?? INSTANCE_STATUS_BADGE.OFFLINE}`}>
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {instance.status}
          </span>
        </div>
      </div>

      {instance.role !== 'REPLICA' && (
        <ReplicaSection instanceId={instance.id} sourceServerId={instance.serverId} replications={instance.replicationsAsPrimary} onChange={load} />
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
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 font-semibold">{value}</p>
    </div>
  );
}

function ReplicaSection({
  instanceId,
  sourceServerId,
  replications,
  onChange,
}: {
  instanceId: string;
  sourceServerId: string;
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
          className="btn-secondary flex items-center gap-1.5 px-3 py-1.5 text-sm"
        >
          <IconPlus className="h-4 w-4" />
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
          sourceServerId={sourceServerId}
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

  return (
    <div className="card mb-3 p-4 text-sm">
      <div className="mb-2 flex items-center justify-between">
        <span className={`badge ${REPLICATION_BADGE[replication.status]}`}>
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          {STATUS_LABEL[replication.status]}
        </span>
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

function CreateReplicaModal({
  instanceId,
  sourceServerId,
  onClose,
  onCreated,
}: {
  instanceId: string;
  sourceServerId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [servers, setServers] = useState<ServerOption[]>([]);
  const [form, setForm] = useState({ targetServerId: '', name: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[] | null>(null);

  useEffect(() => {
    apiFetch<ServerOption[]>('/servers').then(setServers);
  }, []);

  // ponytail: réplica no mesmo servidor colidiria na porta 3306 padrão do
  // container (o formulário não expõe porta customizada) — exclui a origem
  // em vez de deixar escolher e falhar com um erro de bind confuso.
  const targetOptions = servers.filter((s) => s.id !== sourceServerId);

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
    <Modal title={warnings ? 'Réplica criada' : 'Criar réplica'} onClose={warnings ? onCreated : onClose} closeDisabled={saving}>
      {warnings ? (
        <div>
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
          targetOptions.length === 0 ? (
            <div>
              <Alert variant="info">
                Réplica precisa de um segundo servidor com Docker instalado — o servidor de origem não pode ser o próprio destino
                (a porta 3306 já está em uso por essa instância). Cadastre outro servidor e instale o Docker nele primeiro.
              </Alert>
              <button type="button" onClick={onClose} className="mt-4 w-full btn-secondary px-4 py-2 text-sm">
                Fechar
              </button>
            </div>
          ) : (
          <form onSubmit={handleSubmit}>
            <label className="mb-3 block text-sm">
              <span className="mb-1 block font-medium">Servidor de destino</span>
              <select
                required
                value={form.targetServerId}
                onChange={(e) => setForm({ ...form, targetServerId: e.target.value })}
                className="input"
              >
                <option value="">Selecione...</option>
                {targetOptions.map((s) => (
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
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-slate-800"
              >
                Cancelar
              </button>
              <button type="submit" disabled={saving} className="btn-primary flex items-center gap-2 px-4 py-2 text-sm">
                {saving && <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
                {saving ? 'Criando réplica...' : 'Criar réplica'}
              </button>
            </div>
            {saving && <p className="mt-2 text-right text-xs text-slate-400">Dump + cópia dos dados — pode levar minutos.</p>}
          </form>
          )
        )}
    </Modal>
  );
}
