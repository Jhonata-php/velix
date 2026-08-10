'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import type {
  ProjectDetail,
  ProjectService,
  DatabaseBackupConfig,
  DatabaseBackupRun,
  BackupDestinationSummary,
} from '@/lib/types';
import { Breadcrumb } from '@/components/Breadcrumb';
import { Skeleton } from '@/components/Skeleton';
import { Alert } from '@/components/Alert';
import { StatusBadge, type StatusTone } from '@/components/StatusBadge';
import { InstallLogModal } from '@/components/InstallLogModal';
import { SqlImportButton } from '@/components/SqlImportButton';
import { PublishPortControl } from '@/components/PublishPortControl';
import { IconDatabase, IconGlobe, IconFileText, IconClock, IconCheck, IconEye, IconEyeOff, IconCopy } from '@/components/icons';

const STATUS_TONE: Record<string, StatusTone> = { RUNNING: 'success', DEPLOYING: 'info', STOPPED: 'neutral', ERROR: 'danger' };
const RUN_TONE: Record<string, StatusTone> = { SUCCESS: 'success', RUNNING: 'info', ERROR: 'danger' };

function engineLabel(image: string) {
  const img = image.toLowerCase();
  if (img.includes('postgres')) return 'PostgreSQL';
  if (img.includes('mariadb')) return 'MariaDB';
  if (img.includes('mysql')) return 'MySQL';
  return image;
}

function formatBytes(bytes: number | null) {
  if (bytes == null) return '—';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DatabaseDetailPage() {
  const params = useParams<{ id: string }>();
  const databaseId = params.id;

  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [service, setService] = useState<ProjectService | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<Record<string, string> | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [deployingAdminer, setDeployingAdminer] = useState(false);

  // A lista /databases já devolve applicationId — buscamos ela uma vez pra
  // descobrir a qual projeto este banco pertence, depois carregamos o
  // projeto completo (mesmos dados que a tela de serviço genérica usa).
  function load() {
    apiFetch<{ id: string; applicationId: string }[]>('/databases')
      .then((list) => {
        const entry = list.find((d) => d.id === databaseId);
        if (!entry) {
          setError('Banco não encontrado.');
          return;
        }
        return apiFetch<ProjectDetail>(`/applications/${entry.applicationId}`).then((app) => {
          setProject(app);
          const svc = app.services.find((s) => s.id === databaseId);
          if (!svc) {
            setError('Banco não encontrado neste projeto.');
            return;
          }
          setService(svc);
          const deployment = app.deployments.find((d) => d.id === svc.deploymentId);
          if (deployment) {
            apiFetch<Record<string, string>>(`/applications/${app.id}/deployments/${deployment.id}/credentials`)
              .then(setCredentials)
              .catch(() => setCredentials({}));
          }
        });
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Falha ao carregar'));
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [databaseId]);

  function copy(key: string, value: string) {
    navigator.clipboard.writeText(value);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  }

  if (error) return <Alert variant="error">{error}</Alert>;
  if (!project || !service) return <Skeleton className="h-64" />;

  const credEntries = credentials ? Object.entries(credentials) : [];

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <Breadcrumb items={[{ label: 'Bancos de Dados', href: '/databases' }, { label: project.name }]} />
        <div className="mt-1 flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-500">
            <IconDatabase className="h-4.5 w-4.5" aria-hidden />
          </span>
          <div>
            <h1 className="page-title">{project.name}</h1>
            <p className="text-xs text-slate-400">{engineLabel(service.image)}</p>
          </div>
          <StatusBadge tone={STATUS_TONE[service.status] ?? 'neutral'}>{service.status}</StatusBadge>
        </div>
      </div>

      <div className="card space-y-3 p-4">
        <p className="section-label">Conexão</p>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-slate-400">Container</p>
            <p className="truncate font-mono text-xs text-slate-700 dark:text-slate-200">{service.containerName}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Porta publicada</p>
            <p className="text-slate-700 dark:text-slate-200">{service.publishedPort ?? '— (só interna)'}</p>
          </div>
        </div>

        {credEntries.length > 0 && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs text-slate-400">Segredos gerados</p>
              <button onClick={() => setRevealed((v) => !v)} className="flex items-center gap-1 text-xs text-indigo-600 hover:underline dark:text-indigo-400">
                {revealed ? <IconEyeOff className="h-3.5 w-3.5" /> : <IconEye className="h-3.5 w-3.5" />}
                {revealed ? 'Ocultar' : 'Mostrar'}
              </button>
            </div>
            <div className="space-y-1.5">
              {credEntries.map(([key, value]) => (
                <div key={key} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-1.5 dark:border-slate-700">
                  <div className="min-w-0">
                    <p className="text-[11px] text-slate-500">{key}</p>
                    <p className="truncate font-mono text-xs">{revealed ? value : '••••••••••••'}</p>
                  </div>
                  <button onClick={() => copy(key, value)} className="shrink-0 text-xs text-indigo-600 hover:underline dark:text-indigo-400">
                    {copiedKey === key ? <IconCheck className="h-3.5 w-3.5" /> : <IconCopy className="h-3.5 w-3.5" />}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <SqlImportButton
            applicationId={project.id}
            serviceName={service.name}
            image={service.image}
            serverId={project.server.id}
          />
          <button
            onClick={() => setDeployingAdminer(true)}
            disabled={deployingAdminer}
            className="btn-secondary flex items-center gap-1.5 px-3.5 py-2 text-sm disabled:opacity-50"
          >
            <IconGlobe className="h-4 w-4" aria-hidden />
            Abrir interface web
          </button>
        </div>

        <PublishPortControl
          applicationId={project.id}
          serviceName={service.name}
          publishedPort={service.publishedPort}
          onChange={load}
        />
      </div>

      <BackupSection databaseId={databaseId} serverId={project.server.id} />

      {deployingAdminer && (
        <InstallLogModal
          serverId={project.server.id}
          op="service-deploy"
          params={{ applicationId: project.id, manifestSlug: 'adminer', variables: { DEFAULT_SERVER: service.containerName } }}
          title="Implantando Adminer"
          onClose={() => setDeployingAdminer(false)}
          onDone={(ok) => {
            if (ok) load();
          }}
        />
      )}
    </div>
  );
}

function BackupSection({ databaseId, serverId }: { databaseId: string; serverId: string }) {
  const [config, setConfig] = useState<DatabaseBackupConfig | null>(null);
  const [runs, setRuns] = useState<DatabaseBackupRun[] | null>(null);
  const [destinations, setDestinations] = useState<BackupDestinationSummary[]>([]);
  const [scheduledAt, setScheduledAt] = useState('');
  const [retentionDays, setRetentionDays] = useState(14);
  const [destinationId, setDestinationId] = useState('');
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    apiFetch<DatabaseBackupConfig>(`/databases/${databaseId}/backup-config`)
      .then((c) => {
        setConfig(c);
        setScheduledAt(c.scheduledAt ?? '');
        setRetentionDays(c.retentionDays);
        setDestinationId(c.destinationId ?? '');
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Falha ao carregar'));
    apiFetch<DatabaseBackupRun[]>(`/databases/${databaseId}/backup-runs`)
      .then(setRuns)
      .catch((e) => setError(e instanceof Error ? e.message : 'Falha ao carregar'));
    apiFetch<BackupDestinationSummary[]>('/backup-destinations')
      .then(setDestinations)
      .catch((e) => setError(e instanceof Error ? e.message : 'Falha ao carregar'));
  }

  useEffect(load, [databaseId]);

  async function saveSchedule() {
    if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 365) {
      setError('Retenção precisa ser um número inteiro entre 1 e 365 dias.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/databases/${databaseId}/backup-config`, {
        method: 'PATCH',
        body: JSON.stringify({
          scheduledAt: scheduledAt.trim() || null,
          retentionDays,
          destinationId: destinationId || null,
        }),
      });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao salvar agendamento');
    } finally {
      setSaving(false);
    }
  }

  if (error && (!config || !runs)) return <Alert variant="error">{error}</Alert>;
  if (!config || !runs) return <Skeleton className="h-40" />;

  return (
    <div className="card space-y-4 p-4">
      <div className="flex items-center justify-between">
        <p className="section-label">Backups</p>
        <button onClick={() => setRunning(true)} className="btn-primary flex items-center gap-1.5 px-3.5 py-2 text-sm">
          <IconFileText className="h-4 w-4" aria-hidden />
          Fazer backup agora
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 p-3 text-sm sm:grid-cols-3 dark:border-slate-700">
        <label className="block">
          <span className="mb-1 block text-xs text-slate-400">Horário diário (opcional)</span>
          <input type="time" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className="input h-9" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-slate-400">Retenção (dias)</span>
          <input
            type="number"
            min={1}
            max={365}
            value={retentionDays}
            onChange={(e) => setRetentionDays(Number(e.target.value))}
            className="input h-9"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-slate-400">Destino remoto (opcional)</span>
          <select value={destinationId} onChange={(e) => setDestinationId(e.target.value)} className="input h-9">
            <option value="">Só neste servidor</option>
            {destinations.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label} ({d.protocol.toUpperCase()})
              </option>
            ))}
          </select>
        </label>
      </div>
      {destinations.length === 0 && (
        <p className="text-xs text-slate-400">
          Nenhum destino de backup configurado ainda — adicione um em Configurações → Backup.
        </p>
      )}
      {error && <Alert variant="error">{error}</Alert>}
      <div className="flex justify-end">
        <button onClick={saveSchedule} disabled={saving} className="btn-secondary px-3.5 py-2 text-sm disabled:opacity-50">
          {saving ? 'Salvando...' : 'Salvar agendamento'}
        </button>
      </div>

      <div>
        <p className="mb-2 flex items-center gap-1.5 text-xs text-slate-400">
          <IconClock className="h-3.5 w-3.5" aria-hidden />
          Histórico
        </p>
        {runs.length === 0 ? (
          <p className="text-sm text-slate-400">Nenhum backup ainda.</p>
        ) : (
          <div className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
            {runs.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                <div className="min-w-0">
                  <p className="truncate text-slate-700 dark:text-slate-200">{new Date(r.startedAt).toLocaleString('pt-BR')}</p>
                  <p className="truncate text-slate-400">
                    {r.trigger === 'manual' ? 'Manual' : 'Agendado'} · {formatBytes(r.sizeBytes)}
                    {r.uploadedRemote ? ' · enviado ao destino' : ''}
                  </p>
                </div>
                <StatusBadge tone={RUN_TONE[r.status] ?? 'neutral'}>{r.status}</StatusBadge>
              </div>
            ))}
          </div>
        )}
      </div>

      {running && (
        <InstallLogModal
          serverId={serverId}
          op="database-backup-run"
          params={{ projectServiceId: databaseId }}
          title="Fazendo backup"
          onClose={() => setRunning(false)}
          onDone={() => load()}
        />
      )}
    </div>
  );
}
