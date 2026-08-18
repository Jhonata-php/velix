'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiFetch, getToken, clearToken } from '@/lib/api';
import { useAutoRefresh } from '@/lib/useAutoRefresh';
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
import { ConfirmModal, Modal } from '@/components/Modal';
import { PublishPortControl } from '@/components/PublishPortControl';
import { DatabaseDataTab } from '@/components/DatabaseDataTab';
import { LiveLogsPanel } from '@/components/LiveLogsPanel';
import { MetricCard, MetricValue } from '@/components/MetricCard';
import {
  IconDatabase,
  IconFileText,
  IconClock,
  IconCheck,
  IconEye,
  IconEyeOff,
  IconCopy,
  IconDownload,
  IconPower,
  IconRefresh,
  IconActivity,
  IconDisk,
  IconGlobe,
  IconTrash,
  IconPencil,
} from '@/components/icons';

const STATUS_TONE: Record<string, StatusTone> = { RUNNING: 'success', DEPLOYING: 'info', STOPPED: 'neutral', ERROR: 'danger' };
const RUN_TONE: Record<string, StatusTone> = { SUCCESS: 'success', RUNNING: 'info', ERROR: 'danger' };
// Único segredo que dá pra trocar por aqui — os outros (ex.: APP_PASSWORD)
// não têm um comando de troca genérico o bastante pra automatizar ainda.
const ROOT_SECRET_KEYS = new Set(['ROOT_PASSWORD', 'POSTGRES_PASSWORD']);

function engineLabel(image: string) {
  const img = image.toLowerCase();
  if (img.includes('postgres')) return 'PostgreSQL';
  if (img.includes('mariadb')) return 'MariaDB';
  if (img.includes('mysql')) return 'MySQL';
  return image;
}

/** Mesma chave que o manifesto do catálogo declara como segredo pra cada
 * engine (ver apps/api/src/catalog/manifests/*.ts) — é a senha do usuário
 * devolvido por `connection-info`. */
function rootPasswordKey(image: string): string | null {
  const img = image.toLowerCase();
  if (img.includes('postgres')) return 'POSTGRES_PASSWORD';
  if (img.includes('mysql') || img.includes('mariadb')) return 'ROOT_PASSWORD';
  return null;
}

function connectionScheme(image: string): string {
  const img = image.toLowerCase();
  if (img.includes('postgres')) return 'postgresql';
  return 'mysql';
}

interface ConnectionInfo {
  host: string;
  port: number | null;
  username: string | null;
  database: string | null;
}

function formatBytes(bytes: number | null) {
  if (bytes == null) return '—';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DatabaseDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const databaseId = params.id;

  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [service, setService] = useState<ProjectService | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<Record<string, string> | null>(null);
  const [connInfo, setConnInfo] = useState<ConnectionInfo | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [tab, setTab] = useState<'conexao' | 'dados' | 'logs' | 'backups'>('conexao');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [changingPasswordKey, setChangingPasswordKey] = useState<string | null>(null);

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
            apiFetch<ConnectionInfo>(`/applications/${app.id}/deployments/${deployment.id}/connection-info`)
              .then(setConnInfo)
              .catch(() => setConnInfo(null));
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

  async function lifecycleAction(action: 'start' | 'stop' | 'restart') {
    if (!project || !service) return;
    setBusy(true);
    setActionError(null);
    try {
      await apiFetch(`/applications/${project.id}/services/${encodeURIComponent(service.name)}/${action}`, { method: 'POST' });
      load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Falha ao executar ação');
    } finally {
      setBusy(false);
    }
  }

  async function removeDatabase() {
    if (!project || !service) return;
    setRemoving(true);
    setRemoveError(null);
    try {
      await apiFetch(`/applications/${project.id}/deployments/${service.deploymentId}`, { method: 'DELETE' });
      router.push('/databases');
    } catch (e) {
      setRemoveError(e instanceof Error ? e.message : 'Falha ao excluir o banco');
      setRemoving(false);
    }
  }

  if (error) return <Alert variant="error">{error}</Alert>;
  if (!project || !service) return <Skeleton className="h-64" />;

  const credEntries = credentials ? Object.entries(credentials) : [];
  const rootPassword = credentials ? credentials[rootPasswordKey(service.image) ?? ''] : undefined;
  const connectionString =
    connInfo?.host && connInfo.port && connInfo.username && connInfo.database && rootPassword
      ? `${connectionScheme(service.image)}://${connInfo.username}:${rootPassword}@${connInfo.host}:${connInfo.port}/${connInfo.database}`
      : null;

  return (
    <div className="space-y-4">
      <div>
        <Breadcrumb items={[{ label: 'Bancos de Dados', href: '/databases' }, { label: project.name }]} />
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-500">
              <IconDatabase className="h-4.5 w-4.5" aria-hidden />
            </span>
            <div>
              <h1 className="page-title">{project.name}</h1>
              <p className="text-xs text-slate-400">{engineLabel(service.image)}</p>
            </div>
            <StatusBadge tone={STATUS_TONE[service.status] ?? 'neutral'}>{service.status}</StatusBadge>
          </div>
          <div className="flex items-center gap-2">
            {service.status === 'RUNNING' ? (
              <button
                onClick={() => lifecycleAction('stop')}
                disabled={busy}
                className="btn-secondary flex items-center gap-1.5 px-3.5 py-2 text-sm disabled:opacity-50"
              >
                <IconPower className="h-4 w-4" aria-hidden />
                Parar
              </button>
            ) : (
              <button
                onClick={() => lifecycleAction('start')}
                disabled={busy}
                className="btn-primary flex items-center gap-1.5 px-3.5 py-2 text-sm disabled:opacity-50"
              >
                <IconPower className="h-4 w-4" aria-hidden />
                Iniciar
              </button>
            )}
            <button
              onClick={() => lifecycleAction('restart')}
              disabled={busy}
              className="btn-secondary flex items-center gap-1.5 px-3.5 py-2 text-sm disabled:opacity-50"
            >
              <IconRefresh className="h-4 w-4" aria-hidden />
              Reiniciar
            </button>
            <button
              onClick={() => setConfirmRemove(true)}
              aria-label="Excluir banco de dados"
              title="Excluir banco de dados"
              className="rounded-lg p-2 text-slate-400 transition hover:bg-red-500/10 hover:text-red-500"
            >
              <IconTrash className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>
        {actionError && (
          <div className="mt-2">
            <Alert variant="error">{actionError}</Alert>
          </div>
        )}
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-700">
        {(['conexao', 'dados', 'logs', 'backups'] as const).map((key) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition ${
              tab === key
                ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            {key === 'conexao' ? 'Conexão' : key === 'dados' ? 'Dados' : key === 'logs' ? 'Logs' : 'Backups'}
          </button>
        ))}
      </div>

      {tab === 'conexao' && (
      <div className="card space-y-3 p-4">
        <p className="section-label">Conexão</p>
        <p className="text-xs text-slate-400">
          Pra conectar a partir de outro serviço no Velix (mesma rede Docker), use o host e a porta interna abaixo —
          não a porta publicada, que só serve pra acessar de fora do servidor.
        </p>
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <p className="text-xs text-slate-400">Host (container)</p>
            <p className="truncate font-mono text-xs text-slate-700 dark:text-slate-200">{service.containerName}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Porta interna</p>
            <p className="font-mono text-xs text-slate-700 dark:text-slate-200">{connInfo?.port ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Usuário</p>
            <p className="font-mono text-xs text-slate-700 dark:text-slate-200">{connInfo?.username ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Banco</p>
            <p className="truncate font-mono text-xs text-slate-700 dark:text-slate-200">{connInfo?.database ?? '—'}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-slate-400">Porta publicada</p>
            <p className="text-slate-700 dark:text-slate-200">{service.publishedPort ?? '— (só interna)'}</p>
          </div>
        </div>

        {connectionString && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs text-slate-400">String de conexão</p>
              <button onClick={() => setRevealed((v) => !v)} className="flex items-center gap-1 text-xs text-indigo-600 hover:underline dark:text-indigo-400">
                {revealed ? <IconEyeOff className="h-3.5 w-3.5" /> : <IconEye className="h-3.5 w-3.5" />}
                {revealed ? 'Ocultar' : 'Mostrar'}
              </button>
            </div>
            <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-1.5 dark:border-slate-700">
              <p className="truncate font-mono text-xs">
                {revealed ? connectionString : connectionString.replace(/:[^:@]+@/, ':••••••••@')}
              </p>
              <button
                onClick={() => copy('connection-string', connectionString)}
                className="shrink-0 text-xs text-indigo-600 hover:underline dark:text-indigo-400"
              >
                {copiedKey === 'connection-string' ? <IconCheck className="h-3.5 w-3.5" /> : <IconCopy className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
        )}

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
                  <div className="flex shrink-0 items-center gap-2">
                    {ROOT_SECRET_KEYS.has(key) && (
                      <button
                        onClick={() => setChangingPasswordKey(key)}
                        title="Trocar senha"
                        className="text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400"
                      >
                        <IconPencil className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button onClick={() => copy(key, value)} className="text-xs text-indigo-600 hover:underline dark:text-indigo-400">
                      {copiedKey === key ? <IconCheck className="h-3.5 w-3.5" /> : <IconCopy className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <PublishPortControl
          applicationId={project.id}
          serviceName={service.name}
          publishedPort={service.publishedPort}
          onChange={load}
        />
      </div>
      )}

      {tab === 'conexao' && <ResourcesRow applicationId={project.id} serviceName={service.name} />}

      {tab === 'logs' && <LiveLogsPanel serverId={project.server.id} containerId={service.containerName} />}

      {tab === 'dados' && (
        <DatabaseDataTab
          databaseId={databaseId}
          applicationId={project.id}
          serverId={project.server.id}
          serviceName={service.name}
          image={service.image}
        />
      )}

      {tab === 'backups' && <BackupSection databaseId={databaseId} serverId={project.server.id} />}

      {confirmRemove && (
        <ConfirmModal
          title="Excluir banco de dados"
          message={`Excluir "${project.name}"? O container, os volumes e todos os dados são apagados — não dá pra desfazer.`}
          confirmLabel="Excluir"
          danger
          loading={removing}
          error={removeError}
          onConfirm={removeDatabase}
          onCancel={() => {
            setConfirmRemove(false);
            setRemoveError(null);
          }}
        />
      )}

      {changingPasswordKey && (
        <ChangeRootPasswordModal
          databaseId={databaseId}
          onClose={() => setChangingPasswordKey(null)}
          onChanged={() => {
            setChangingPasswordKey(null);
            load();
          }}
        />
      )}
    </div>
  );
}

/** Troca a senha do usuário administrador (root/postgres) de verdade — roda
 * o ALTER no banco e atualiza o segredo salvo, então nada mais precisa
 * mudar depois. Mostra o valor novo uma vez só, na hora — depois disso só
 * dá pra ver de novo revelando o segredo salvo, igual antes. */
function ChangeRootPasswordModal({ databaseId, onClose, onChanged }: { databaseId: string; onClose: () => void; onChanged: () => void }) {
  const [mode, setMode] = useState<'auto' | 'custom'>('auto');
  const [customPassword, setCustomPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const valid = mode === 'auto' || customPassword.trim().length >= 8;

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const body = mode === 'custom' ? { password: customPassword.trim() } : {};
      const res = await apiFetch<{ password: string }>(`/databases/${databaseId}/root-password`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setResult(res.password);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao trocar a senha');
    } finally {
      setSaving(false);
    }
  }

  function copyResult() {
    if (!result) return;
    navigator.clipboard.writeText(result);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (result) {
    return (
      <Modal title="Senha trocada" onClose={onClose} maxWidth="max-w-sm">
        <div className="space-y-4">
          <Alert variant="success">Pronto — guarde a senha agora, essa é a única vez que ela aparece assim.</Alert>
          <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
            <p className="truncate font-mono text-sm">{result}</p>
            <button onClick={copyResult} className="shrink-0 text-xs text-indigo-600 hover:underline dark:text-indigo-400">
              {copied ? 'Copiado' : 'Copiar'}
            </button>
          </div>
          <div className="flex justify-end">
            <button onClick={onClose} className="btn-primary px-3.5 py-2 text-sm">
              Fechar
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Trocar senha do administrador" onClose={saving ? undefined : onClose} closeDisabled={saving} maxWidth="max-w-sm">
      <div className="space-y-4">
        <p className="text-xs text-slate-400">Troca a senha de verdade no banco e atualiza o segredo salvo — nada mais precisa mudar.</p>
        <div className="flex gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800/60">
          <button onClick={() => setMode('auto')} className={`tab-pill flex-1 ${mode === 'auto' ? 'tab-pill-active' : ''}`}>
            Gerar automática
          </button>
          <button onClick={() => setMode('custom')} className={`tab-pill flex-1 ${mode === 'custom' ? 'tab-pill-active' : ''}`}>
            Definir senha
          </button>
        </div>
        {mode === 'custom' && (
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-slate-700 dark:text-slate-200">Nova senha</span>
            <input
              value={customPassword}
              onChange={(e) => setCustomPassword(e.target.value)}
              placeholder="Mínimo 8 caracteres"
              autoFocus
              className="input font-mono text-sm"
            />
          </label>
        )}
        {error && <Alert variant="error">{error}</Alert>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} disabled={saving} className="btn-secondary px-3.5 py-2 text-sm disabled:opacity-50">
            Cancelar
          </button>
          <button onClick={submit} disabled={saving || !valid} className="btn-primary px-3.5 py-2 text-sm disabled:opacity-50">
            {saving ? 'Trocando...' : 'Trocar senha'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

const CPU_HISTORY_SIZE = 20;

/** Mini-gráfico de linha sem depender de nenhuma lib de charting — só um
 * polyline SVG sobre a janela de amostras recentes. Pra um único número que
 * atualiza a cada 5s, isso já cobre o que se pede ("ver a tendência"), sem
 * puxar uma dependência nova pra um caso tão simples. */
function Sparkline({ values, max = 100 }: { values: number[]; max?: number }) {
  if (values.length < 2) return <div className="mt-1.5 h-7" />;
  const w = 100;
  const h = 28;
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - (Math.min(Math.max(v, 0), max) / max) * h;
      return `${x},${y}`;
    })
    .join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-1.5 h-7 w-full text-indigo-500" preserveAspectRatio="none" aria-hidden>
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function ResourcesRow({ applicationId, serviceName }: { applicationId: string; serviceName: string }) {
  const [stats, setStats] = useState<{ cpu: string | null; memory: string | null; network: string | null } | null>(null);
  const [cpuHistory, setCpuHistory] = useState<number[]>([]);

  function load() {
    apiFetch<{ cpu: string | null; memory: string | null; network: string | null }>(
      `/applications/${applicationId}/services/${encodeURIComponent(serviceName)}/stats`,
    )
      .then((s) => {
        setStats(s);
        const parsed = s.cpu ? Number.parseFloat(s.cpu) : NaN;
        if (!Number.isNaN(parsed)) setCpuHistory((prev) => [...prev.slice(-(CPU_HISTORY_SIZE - 1)), parsed]);
      })
      .catch(() => {});
  }

  useEffect(load, [applicationId, serviceName]);
  useAutoRefresh(load, 5_000);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <MetricCard icon={<IconActivity className="h-3.5 w-3.5" />} label="CPU">
        <MetricValue>{stats?.cpu ?? '—'}</MetricValue>
        <Sparkline values={cpuHistory} />
      </MetricCard>
      <MetricCard icon={<IconDisk className="h-3.5 w-3.5" />} label="Memória">
        <MetricValue>{stats?.memory ?? '—'}</MetricValue>
      </MetricCard>
      <MetricCard icon={<IconGlobe className="h-3.5 w-3.5" />} label="Rede (I/O)">
        <MetricValue>{stats?.network ?? '—'}</MetricValue>
      </MetricCard>
    </div>
  );
}

/** Baixa um backup mantido só neste servidor (não enviado a um destino
 * remoto) — a rota exige o Bearer token, não cookie de sessão, então não dá
 * pra usar um `<a href>` puro: busca como blob e dispara o download via URL
 * de objeto. */
async function downloadBackup(databaseId: string, runId: string, fileName: string) {
  const token = getToken();
  const res = await fetch(`/api/databases/${databaseId}/backup-runs/${runId}/download`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (res.status === 401) {
    clearToken();
    if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `/login?next=${next}`;
    }
    throw new Error('Sua sessão expirou. Entre novamente.');
  }
  if (!res.ok) throw new Error('Falha ao baixar o backup');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function BackupSection({ databaseId, serverId }: { databaseId: string; serverId: string }) {
  const [config, setConfig] = useState<DatabaseBackupConfig | null>(null);
  const [runs, setRuns] = useState<DatabaseBackupRun[] | null>(null);
  const [destinations, setDestinations] = useState<BackupDestinationSummary[]>([]);
  const [schemas, setSchemas] = useState<string[] | null>(null);
  const [scheduledAt, setScheduledAt] = useState('');
  const [retentionDays, setRetentionDays] = useState(14);
  const [destinationId, setDestinationId] = useState('');
  const [database, setDatabase] = useState('');
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  async function handleDownload(runId: string, fileName: string) {
    setDownloadingId(runId);
    setError(null);
    try {
      await downloadBackup(databaseId, runId, fileName);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao baixar o backup');
    } finally {
      setDownloadingId(null);
    }
  }

  function load() {
    apiFetch<DatabaseBackupConfig>(`/databases/${databaseId}/backup-config`)
      .then((c) => {
        setConfig(c);
        setScheduledAt(c.scheduledAt ?? '');
        setRetentionDays(c.retentionDays);
        setDestinationId(c.destinationId ?? '');
        setDatabase(c.database ?? '');
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Falha ao carregar'));
    apiFetch<DatabaseBackupRun[]>(`/databases/${databaseId}/backup-runs`)
      .then(setRuns)
      .catch((e) => setError(e instanceof Error ? e.message : 'Falha ao carregar'));
    apiFetch<BackupDestinationSummary[]>('/backup-destinations')
      .then(setDestinations)
      .catch((e) => setError(e instanceof Error ? e.message : 'Falha ao carregar'));
    // Mesma rota que a aba Dados usa pra listar os bancos de verdade da
    // instância — o dropdown de destino do dump usa nomes reais em vez de
    // depender do fallback fixo "app" de resolvedDatabaseName().
    apiFetch<string[]>(`/databases/${databaseId}/schemas`)
      .then(setSchemas)
      .catch(() => setSchemas([]));
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
          database: database || null,
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

      <div className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 p-3 text-sm sm:grid-cols-4 dark:border-slate-700">
        <label className="block">
          <span className="mb-1 block text-xs text-slate-400">Banco de dados</span>
          <select value={database} onChange={(e) => setDatabase(e.target.value)} className="input h-9">
            <option value="">Todos os bancos</option>
            {schemas?.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
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
                  {r.status === 'ERROR' && r.error && <p className="truncate text-red-500 dark:text-red-400">{r.error}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {r.status === 'SUCCESS' && !r.uploadedRemote && r.fileName && (
                    <button
                      onClick={() => handleDownload(r.id, r.fileName!)}
                      disabled={downloadingId === r.id}
                      aria-label="Baixar backup"
                      title="Baixar backup"
                      className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-indigo-600 disabled:opacity-50 dark:hover:bg-slate-700"
                    >
                      <IconDownload className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  )}
                  <StatusBadge tone={RUN_TONE[r.status] ?? 'neutral'}>{r.status}</StatusBadge>
                </div>
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
