'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { useAutoRefresh } from '@/lib/useAutoRefresh';
import { groupContainers, serviceLabel, type DockerContainer } from '@/lib/containerGroups';
import type { DatabaseInstanceSummary } from '@/lib/types';
import { Alert } from '@/components/Alert';
import { ConfirmModal } from '@/components/Modal';
import { ContainerLogsModal } from '@/components/ContainerLogsModal';
import { CloneContainerModal } from '@/components/CloneContainerModal';
import { QuickReplicateModal } from '@/components/QuickReplicateModal';
import { BulkCloneGroupModal } from '@/components/BulkCloneGroupModal';
import { ContainerCard } from '@/components/ContainerCard';
import { Breadcrumb } from '@/components/Breadcrumb';
import { Skeleton } from '@/components/Skeleton';
import { IconServer } from '@/components/icons';

interface DockerStatusResp {
  installed: boolean;
  version?: string;
  containers?: DockerContainer[];
}

export default function ProjectDetailPage() {
  const params = useParams<{ id: string; key: string }>();
  const serverId = params.id;
  const projectKey = decodeURIComponent(params.key);

  const [serverName, setServerName] = useState<string | null>(null);
  const [status, setStatus] = useState<DockerStatusResp | null>(null);
  const [instances, setInstances] = useState<DatabaseInstanceSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [containerLoading, setContainerLoading] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<DockerContainer | null>(null);
  const [logsTarget, setLogsTarget] = useState<DockerContainer | null>(null);
  const [cloneTarget, setCloneTarget] = useState<DockerContainer | null>(null);
  const [replicateTarget, setReplicateTarget] = useState<DatabaseInstanceSummary | null>(null);
  const [showBulk, setShowBulk] = useState(false);

  function load() {
    apiFetch<{ name: string }>(`/servers/${serverId}`).then((s) => setServerName(s.name));
    apiFetch<DockerStatusResp>(`/servers/${serverId}/docker/status`)
      .then(setStatus)
      .catch((e) => setError(e.message));
    apiFetch<DatabaseInstanceSummary[]>(`/servers/${serverId}/databases`).then(setInstances);
  }

  useEffect(load, [serverId]);
  useAutoRefresh(load, 10_000);

  const group = groupContainers(status?.containers ?? []).find((g) => g.key === projectKey);

  async function handleToggle(c: DockerContainer) {
    const running = c.status.toLowerCase().includes('up');
    setContainerLoading(c.id);
    setError(null);
    try {
      await apiFetch(`/servers/${serverId}/docker/containers/${c.id}/${running ? 'stop' : 'start'}`, { method: 'POST' });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Falha ao ${running ? 'parar' : 'iniciar'} container`);
    } finally {
      setContainerLoading(null);
    }
  }

  async function handleRemoveConfirmed() {
    if (!confirmRemove) return;
    setContainerLoading(confirmRemove.id);
    try {
      await apiFetch(`/servers/${serverId}/docker/containers/${confirmRemove.id}`, { method: 'DELETE' });
      setConfirmRemove(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao remover container');
    } finally {
      setContainerLoading(null);
    }
  }

  if (error) return <Alert variant="error">{error}</Alert>;
  if (!group) {
    return (
      <div>
        <Skeleton className="mb-2 h-3 w-40" />
        <Skeleton className="mb-6 h-7 w-56" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      </div>
    );
  }

  const activeCount = group.containers.filter((c) => c.status.toLowerCase().includes('up')).length;

  return (
    <div>
      <Breadcrumb items={[{ label: serverName ?? 'Servidor', href: `/servers/${serverId}` }, { label: 'Docker' }]} />
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="icon-chip bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400">
            <IconServer className="h-5 w-5" />
          </span>
          <div>
            <h1 className="page-title">{projectKey}</h1>
            <p className="text-sm text-slate-500">
              {activeCount}/{group.containers.length} serviços ativos
            </p>
          </div>
        </div>
        <button onClick={() => setShowBulk(true)} className="btn-secondary px-4 py-2 text-sm">
          Clonar tudo
        </button>
      </div>

      {error && (
        <div className="mb-4">
          <Alert variant="error">{error}</Alert>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {group.containers.map((c) => {
          const busy = containerLoading === c.id;
          const instance = instances.find((i) => i.containerName === c.names);
          const isReplica = instance?.role === 'REPLICA';
          return (
            <ContainerCard
              key={c.id}
              container={c}
              label={serviceLabel(c.names, projectKey)}
              canReplicate={!!instance}
              isReplica={isReplica}
              busy={busy}
              onLogs={() => setLogsTarget(c)}
              onReplicate={() => instance && setReplicateTarget(instance)}
              onClone={() => setCloneTarget(c)}
              onToggle={() => handleToggle(c)}
              onRemove={() => setConfirmRemove(c)}
            />
          );
        })}
      </div>

      {confirmRemove && (
        <ConfirmModal
          title="Remover container"
          message={`Remover o container "${confirmRemove.names}"? Essa ação não pode ser desfeita.`}
          confirmLabel="Remover"
          danger
          loading={containerLoading === confirmRemove.id}
          onConfirm={handleRemoveConfirmed}
          onCancel={() => setConfirmRemove(null)}
        />
      )}

      {logsTarget && (
        <ContainerLogsModal serverId={serverId} containerId={logsTarget.id} title={logsTarget.names} onClose={() => setLogsTarget(null)} />
      )}

      {cloneTarget && (
        <CloneContainerModal
          sourceServerId={serverId}
          container={cloneTarget}
          onClose={() => setCloneTarget(null)}
          onCloned={() => setCloneTarget(null)}
        />
      )}

      {replicateTarget && (
        <QuickReplicateModal
          instance={replicateTarget}
          currentServerId={serverId}
          onClose={() => setReplicateTarget(null)}
          onCreated={() => {
            setReplicateTarget(null);
            load();
          }}
        />
      )}

      {showBulk && (
        <BulkCloneGroupModal sourceServerId={serverId} group={group} instances={instances} onClose={() => setShowBulk(false)} />
      )}
    </div>
  );
}
