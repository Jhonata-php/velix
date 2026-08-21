'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiFetch, getToken } from '@/lib/api';
import { useAutoRefresh } from '@/lib/useAutoRefresh';
import { formatUptime } from '@/lib/formatUptime';
import { useInstallWizard } from '@/lib/useInstallWizard';
import { useTheme } from 'next-themes';
import { getTerminalTheme } from '@/lib/terminalTheme';
import { type DockerContainer, groupContainers, avatarColor, stripSwarmSuffix } from '@/lib/containerGroups';
import type { DatabaseInstanceSummary, CatalogApplicationSummary, CatalogApplicationDetail } from '@/lib/types';
import { Bar } from '@/components/Bar';
import { Alert } from '@/components/Alert';
import { AppIcon } from '@/components/AppIcon';
import { CompactAppCard } from '@/components/CompactAppCard';
import { DeployWizard } from '@/components/DeployWizard';
import { CreateProjectModal } from '@/components/CreateProjectModal';
import { InstallLogModal, OpsLogPanel, type OpsLogStatus } from '@/components/InstallLogModal';
import { Modal, ConfirmModal } from '@/components/Modal';
import { ServerFormModal } from '@/components/ServerFormModal';
import { Sparkline } from '@/components/Sparkline';
import { MetricHistoryPanel } from '@/components/MetricHistoryPanel';
import { ContainerLogsModal } from '@/components/ContainerLogsModal';
import { CloneContainerModal } from '@/components/CloneContainerModal';
import { QuickReplicateModal } from '@/components/QuickReplicateModal';
import { ContainerRow } from '@/components/ContainerRow';
import { MetricCard } from '@/components/MetricCard';
import { StatusBadge, CapabilityBadge, RowStatusLabel, rowStatusBorderClass, type StatusTone } from '@/components/StatusBadge';
import { ActionMenu, type ActionMenuItem } from '@/components/ActionMenu';
import { Breadcrumb } from '@/components/Breadcrumb';
import { TerminalWindow, TerminalActionButton } from '@/components/TerminalChrome';
import { Skeleton, SkeletonRow } from '@/components/Skeleton';
import { ServerHeader } from '@/components/ServerHeader';
import { ContextNav, type ContextNavGroup } from '@/components/ContextNav';
import { ModuleHeader } from '@/components/ModuleHeader';
import { Toolbar } from '@/components/Toolbar';
import { DockerSummary } from '@/components/DockerSummary';
import { OperationalPanel, OperationalPanelSection } from '@/components/OperationalPanel';
import { EmptyState } from '@/components/EmptyState';
import {
  IconDownload,
  IconPlus,
  IconPlug,
  IconClock,
  IconActivity,
  IconMemory,
  IconDisk,
  IconServer,
  IconPencil,
  IconTrash,
  IconPower,
  IconBox,
  IconTerminal,
  IconRefresh,
  IconGlobe,
  IconShield,
  IconLayoutGrid,
  IconStore,
  IconSearch,
  IconKey,
  IconLayers,
} from '@/components/icons';
import '@xterm/xterm/css/xterm.css';

interface ServerMetrics {
  uptimeText: string | null;
  loadAvg: [number, number, number] | null;
  memTotalMb: number | null;
  memUsedMb: number | null;
  diskTotal: string | null;
  diskUsed: string | null;
  diskPercent: string | null;
}

interface Server {
  id: string;
  name: string;
  publicIp: string | null;
  privateIp: string | null;
  hostname: string | null;
  sshPort: number;
  sshUser: string;
  authMethod: 'PASSWORD' | 'PRIVATE_KEY';
  status: string;
  osName: string | null;
  osVersion: string | null;
  packageManager: string | null;
  dockerInstalled: boolean;
  dockerVersion: string | null;
  // Mantido só pra compat de leitura — não é mais exibido (substituído pelo Traefik/Velix).
  easypanelInstalled: boolean;
  easypanelUrl: string | null;
  traefikInstalled: boolean;
  traefikVersion: string | null;
  platformState: string;
  isLocal?: boolean;
  metrics: ServerMetrics | null;
  metricsCheckedAt: string | null;
  lastCheckedAt: string | null;
}

type TabKey = 'overview' | 'updates' | 'docker' | 'applications' | 'library' | 'proxy' | 'terminal';

// Nav contextual agrupada. Só itens com tela real — módulos futuros
// (Backups, Monitoramento, Rede, Segurança) entram aqui conforme forem construídos.
const NAV_GROUPS: ContextNavGroup[] = [
  {
    label: 'Geral',
    items: [
      { key: 'overview', label: 'Visão geral', icon: <IconActivity /> },
      { key: 'updates', label: 'Atualizações', icon: <IconDownload /> },
    ],
  },
  {
    label: 'Plataforma',
    items: [
      { key: 'docker', label: 'Docker', icon: <IconBox /> },
      { key: 'applications', label: 'Projetos', icon: <IconLayoutGrid /> },
      { key: 'library', label: 'Biblioteca', icon: <IconStore /> },
      { key: 'proxy', label: 'Proxy e domínios', icon: <IconGlobe /> },
    ],
  },
  {
    label: 'Operação',
    items: [{ key: 'terminal', label: 'Terminal', icon: <IconTerminal /> }],
  },
];

const PLATFORM_STATE: Record<string, { tone: StatusTone; label: string }> = {
  NOT_PREPARED: { tone: 'neutral', label: 'Não preparado' },
  PREPARING: { tone: 'info', label: 'Preparando' },
  READY: { tone: 'success', label: 'Pronto' },
  DEGRADED: { tone: 'warning', label: 'Degradado' },
  ERROR: { tone: 'danger', label: 'Erro' },
};

export default function ServerDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [server, setServer] = useState<Server | null>(null);
  const [tab, setTab] = useState<TabKey>('overview');
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function load() {
    apiFetch<Server>(`/servers/${params.id}`).then(setServer);
  }

  useEffect(load, [params.id]);

  async function handleDelete() {
    if (!server) return;
    setDeleteLoading(true);
    setDeleteError(null);
    try {
      await apiFetch(`/servers/${server.id}`, { method: 'DELETE' });
      router.push('/servers');
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Falha ao excluir servidor');
      setDeleteLoading(false);
    }
  }

  if (!server) {
    return (
      <div>
        <Skeleton className="mb-2 h-6 w-48" />
        <Skeleton className="mb-4 h-3.5 w-64" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      </div>
    );
  }

  const actions: ActionMenuItem[] = [
    { label: 'Editar servidor', icon: <IconPencil className="h-4 w-4" />, onClick: () => setEditing(true) },
    { label: 'Excluir servidor', icon: <IconTrash className="h-4 w-4" />, onClick: () => setDeleting(true), danger: true },
  ];

  return (
    <div>
      <Breadcrumb items={[{ label: 'Servidores', href: '/servers' }, { label: server.name }]} />

      <ServerHeader
        name={server.name}
        status={server.status as 'PENDING' | 'ONLINE' | 'OFFLINE' | 'ERROR'}
        actions={actions}
        meta={
          <>
            {server.publicIp ?? server.privateIp ?? server.hostname}
            {server.osName && ` · ${server.osName} ${server.osVersion ?? ''}`}
            {server.lastCheckedAt && ` · verificado ${new Date(server.lastCheckedAt).toLocaleString('pt-BR')}`}
          </>
        }
        badges={
          <>
            <StatusBadge tone={(PLATFORM_STATE[server.platformState] ?? PLATFORM_STATE.NOT_PREPARED).tone}>
              {(PLATFORM_STATE[server.platformState] ?? PLATFORM_STATE.NOT_PREPARED).label}
            </StatusBadge>
            <CapabilityBadge ok={server.dockerInstalled} label={server.dockerInstalled ? `Docker ${server.dockerVersion ?? ''}` : 'Docker não instalado'} />
            <CapabilityBadge
              ok={server.traefikInstalled}
              label={server.traefikInstalled ? `Traefik ${server.traefikVersion ?? ''}` : 'Traefik não instalado'}
            />
          </>
        }
      />

      <div className="flex flex-col gap-6 md:flex-row">
        <ContextNav groups={NAV_GROUPS} active={tab} onSelect={(key) => setTab(key as TabKey)} />

        <div className="min-w-0 flex-1">
          {tab === 'overview' && <OverviewTab server={server} onChange={load} />}
          {tab === 'updates' && <UpdatesTab serverId={server.id} />}
          {tab === 'docker' && <DockerTab server={server} onChange={load} />}
          {tab === 'applications' && <ApplicationsTab server={server} onGoToLibrary={() => setTab('library')} />}
          {tab === 'library' && <LibraryTab server={server} />}
          {tab === 'proxy' && <ProxyTab server={server} onChange={load} />}
          {tab === 'terminal' && <TerminalTab serverId={server.id} />}
        </div>
      </div>

      {editing && (
        <ServerFormModal
          server={server}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            load();
          }}
        />
      )}

      {deleting && (
        <ConfirmModal
          title="Excluir servidor"
          message={`Tem certeza que quer excluir "${server.name}"? Isso remove o cadastro do Velix — nada é desinstalado no servidor.`}
          confirmLabel="Excluir"
          danger
          loading={deleteLoading}
          error={deleteError}
          onConfirm={handleDelete}
          onCancel={() => setDeleting(false)}
        />
      )}
    </div>
  );
}

interface TestResult {
  ok: boolean;
  message: string;
}

interface DnsMatch {
  id: string;
  name: string;
  type: string;
  zoneName: string;
  proxied: boolean;
}

function OverviewTab({ server, onChange }: { server: Server; onChange: () => void }) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [domains, setDomains] = useState<DnsMatch[] | null>(null);
  const [domainsError, setDomainsError] = useState<string | null>(null);
  const [collecting, setCollecting] = useState(false);
  const [rebooting, setRebooting] = useState(false);
  const [rebootConfirm, setRebootConfirm] = useState(false);
  const [rebootMessage, setRebootMessage] = useState<string | null>(null);
  const [loadHistory, setLoadHistory] = useState<number[]>([]);
  const [memHistory, setMemHistory] = useState<number[]>([]);
  const [diskHistory, setDiskHistory] = useState<number[]>([]);
  const [showSystemLogs, setShowSystemLogs] = useState<'syslog' | 'auth' | 'velix-api' | null>(null);

  function loadRecentHistory() {
    apiFetch<{ loadAvg1: number | null; memUsedMb: number | null; memTotalMb: number | null; diskPercent: number | null }[]>(
      `/servers/${server.id}/metrics/history?hours=1`,
    ).then((samples) => {
      setLoadHistory(samples.map((s) => s.loadAvg1).filter((v): v is number => v != null));
      setMemHistory(
        samples.filter((s) => s.memTotalMb && s.memUsedMb != null).map((s) => (s.memUsedMb! / s.memTotalMb!) * 100),
      );
      setDiskHistory(samples.map((s) => s.diskPercent).filter((v): v is number => v != null));
    });
  }

  function collectMetrics() {
    setCollecting(true);
    apiFetch<{ online: boolean; metrics: ServerMetrics | null }>(`/servers/${server.id}/metrics`)
      .then(() => {
        loadRecentHistory();
        onChange();
      })
      .finally(() => setCollecting(false));
  }

  useEffect(collectMetrics, [server.id]);
  useAutoRefresh(collectMetrics, 10_000);

  async function handleTest() {
    setTesting(true);
    setResult(null);
    try {
      const res = await apiFetch<TestResult>(`/servers/${server.id}/test-connection`, { method: 'POST' });
      setResult(res);
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : 'Falha ao testar conexão' });
    } finally {
      setTesting(false);
      onChange();
    }
  }

  async function handleReboot() {
    setRebooting(true);
    setRebootMessage(null);
    try {
      const res = await apiFetch<{ ok: boolean; message: string }>(`/servers/${server.id}/reboot`, { method: 'POST' });
      setRebootMessage(res.message);
    } catch (err) {
      setRebootMessage(err instanceof Error ? err.message : 'Falha ao reiniciar servidor');
    } finally {
      setRebooting(false);
      setRebootConfirm(false);
    }
  }

  async function handleLookupDomains() {
    const ip = server.publicIp;
    if (!ip) {
      setDomainsError('Servidor não possui IP público cadastrado');
      return;
    }
    setLookingUp(true);
    setDomainsError(null);
    setDomains(null);
    try {
      const matches = await apiFetch<DnsMatch[]>(`/cloudflare/lookup?ip=${encodeURIComponent(ip)}`);
      setDomains(matches);
    } catch (err) {
      setDomainsError(err instanceof Error ? err.message : 'Falha ao consultar Cloudflare');
    } finally {
      setLookingUp(false);
    }
  }

  const memPercent =
    server.metrics?.memTotalMb && server.metrics.memUsedMb != null ? (server.metrics.memUsedMb / server.metrics.memTotalMb) * 100 : null;
  const diskPercent = server.metrics?.diskPercent ? Number(server.metrics.diskPercent.replace('%', '')) : null;

  const overviewActions: ActionMenuItem[] = [
    { label: testing ? 'Testando conexão...' : 'Testar conexão', icon: <IconPlug className="h-4 w-4" />, onClick: handleTest, disabled: testing },
    { label: lookingUp ? 'Buscando domínios...' : 'Localizar domínios', icon: <IconGlobe className="h-4 w-4" />, onClick: handleLookupDomains, disabled: lookingUp },
    { label: 'Logs do sistema', icon: <IconTerminal className="h-4 w-4" />, onClick: () => setShowSystemLogs('syslog') },
    { label: 'Logs de autenticação (SSH)', icon: <IconTerminal className="h-4 w-4" />, onClick: () => setShowSystemLogs('auth') },
    ...(server.isLocal
      ? [{ label: 'Logs do painel (Velix)', icon: <IconTerminal className="h-4 w-4" />, onClick: () => setShowSystemLogs('velix-api' as const) }]
      : []),
    { label: 'Reiniciar servidor', icon: <IconPower className="h-4 w-4" />, onClick: () => setRebootConfirm(true), danger: true },
  ];

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="section-title">Métricas</h2>
        <div className="flex items-center gap-2">
          <button onClick={collectMetrics} disabled={collecting} className="btn-secondary px-3 py-1.5 text-xs">
            {collecting ? 'Atualizando...' : '↻ Atualizar agora'}
          </button>
          <ActionMenu items={overviewActions} />
        </div>
      </div>

      {result && (
        <div className="mb-3">
          <Alert variant={result.ok ? 'success' : 'error'}>{result.message}</Alert>
        </div>
      )}
      {domainsError && (
        <div className="mb-3">
          <Alert variant="error">{domainsError}</Alert>
        </div>
      )}
      {domains && (
        <div className="card mb-3 p-3.5">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Domínios Cloudflare apontando pra este servidor</h3>
          <ul className="space-y-1 text-sm">
            {domains.length === 0 && <li className="text-slate-400">Nenhum domínio aponta para este IP.</li>}
            {domains.map((d) => (
              <li key={d.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
                <span>{d.name}</span>
                <span className="text-xs text-slate-400">
                  {d.type} · {d.zoneName} {d.proxied ? '· proxy' : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <MetricCard icon={<IconServer className="h-4 w-4" />} chipClassName="bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400" label="Sistema operacional">
          <p className="truncate text-xl font-bold tracking-tight">{server.osName ? `${server.osName} ${server.osVersion ?? ''}` : '—'}</p>
        </MetricCard>

        <MetricCard icon={<IconClock className="h-4 w-4" />} chipClassName="bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-400" label="Uptime">
          <p className="text-xl font-bold tracking-tight">{formatUptime(server.metrics?.uptimeText)}</p>
        </MetricCard>

        <MetricCard
          icon={<IconActivity className="h-4 w-4" />}
          chipClassName="bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-400"
          label="Load average"
        >
          {server.metrics?.loadAvg ? (
            <>
              <p className="text-xl font-bold tracking-tight">{server.metrics.loadAvg.join(' · ')}</p>
              <Sparkline data={loadHistory} className="mt-2 h-10 w-full text-violet-500 dark:text-violet-400" />
            </>
          ) : (
            <p className="text-xl font-bold tracking-tight">—</p>
          )}
        </MetricCard>

        <MetricCard
          icon={<IconMemory className="h-4 w-4" />}
          chipClassName="bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400"
          label="Memória"
        >
          {memPercent !== null ? (
            <>
              <div className="flex items-baseline justify-between">
                <p className="text-xl font-bold tracking-tight">{Math.round(memPercent)}%</p>
                <span className="shrink-0 text-xs text-slate-400">
                  {server.metrics?.memUsedMb}/{server.metrics?.memTotalMb}MB
                </span>
              </div>
              <Sparkline data={memHistory} className="mt-2 h-10 w-full text-amber-500 dark:text-amber-400" />
            </>
          ) : (
            <p className="text-xl font-bold tracking-tight">—</p>
          )}
        </MetricCard>

        <MetricCard
          icon={<IconDisk className="h-4 w-4" />}
          chipClassName="bg-teal-50 text-teal-600 dark:bg-teal-500/10 dark:text-teal-400"
          label="Disco"
        >
          {diskPercent !== null ? (
            <>
              <div className="flex items-baseline justify-between">
                <p className="text-xl font-bold tracking-tight">{Math.round(diskPercent)}%</p>
                <span className="shrink-0 text-xs text-slate-400">
                  {server.metrics?.diskUsed}/{server.metrics?.diskTotal}
                </span>
              </div>
              <Sparkline data={diskHistory} className="mt-2 h-10 w-full text-teal-500 dark:text-teal-400" />
            </>
          ) : (
            <p className="text-xl font-bold tracking-tight">—</p>
          )}
        </MetricCard>
      </div>

      <MetricHistoryPanel serverId={server.id} />

      {rebootConfirm && (
        <ConfirmModal
          title="Reiniciar servidor"
          message="Tem certeza que quer reiniciar este servidor agora? Ele fica indisponível por alguns minutos até voltar."
          confirmLabel={rebooting ? 'Enviando...' : 'Sim, reiniciar'}
          danger
          loading={rebooting}
          onConfirm={handleReboot}
          onCancel={() => setRebootConfirm(false)}
        />
      )}
      {rebootMessage && (
        <div className="mt-3">
          <Alert variant="info">{rebootMessage}</Alert>
        </div>
      )}

      {showSystemLogs && (
        <ContainerLogsModal
          serverId={server.id}
          endpoint={
            showSystemLogs === 'velix-api'
              ? `/servers/${server.id}/docker/containers/velix-api/logs?tail=300`
              : `/servers/${server.id}/system-logs?source=${showSystemLogs}&tail=300`
          }
          title={showSystemLogs === 'syslog' ? 'Logs do sistema' : showSystemLogs === 'auth' ? 'Logs de autenticação (SSH)' : 'Logs do painel (Velix)'}
          onClose={() => setShowSystemLogs(null)}
        />
      )}
    </div>
  );
}

interface UpgradablePackage {
  name: string;
  version: string;
  security: boolean;
}

interface UpdatesInfo {
  packageManager: string;
  total: number;
  security: number;
  packages: UpgradablePackage[];
}


function UpdatesTab({ serverId }: { serverId: string }) {
  const [checking, setChecking] = useState(false);
  const [info, setInfo] = useState<UpdatesInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logParams, setLogParams] = useState<{ securityOnly: boolean } | null>(null);

  async function handleCheck() {
    setChecking(true);
    setError(null);
    try {
      const res = await apiFetch<UpdatesInfo>(`/servers/${serverId}/updates`);
      setInfo(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao verificar atualizações');
    } finally {
      setChecking(false);
    }
  }

  return (
    <div>
      <div className="mb-4 flex gap-2">
        <button
          onClick={handleCheck}
          disabled={checking}
          className="btn-secondary px-4 py-2 text-sm"
        >
          {checking ? 'Verificando...' : 'Verificar atualizações'}
        </button>
        {info && info.total > 0 && (
          <>
            <button
              onClick={() => setLogParams({ securityOnly: true })}
              disabled={info.security === 0}
              className="rounded-lg border border-amber-300 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-900/20"
            >
              Instalar só segurança ({info.security})
            </button>
            <button onClick={() => setLogParams({ securityOnly: false })} className="btn-primary px-4 py-2 text-sm">
              Instalar todas ({info.total})
            </button>
          </>
        )}
      </div>

      {error && (
        <div className="mb-3">
          <Alert variant="error">{error}</Alert>
        </div>
      )}

      {info && (
        <p className="mb-3 text-sm text-slate-500">
          Gerenciador: {info.packageManager} · {info.total} pacote(s) desatualizado(s), {info.security} de segurança
        </p>
      )}

      {info && info.packages.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Pacote</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Versão</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Segurança</th>
              </tr>
            </thead>
            <tbody>
              {info.packages.map((p) => (
                <tr key={p.name} className="border-t border-slate-100 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/40">
                  <td className="px-4 py-3">{p.name}</td>
                  <td className="px-4 py-3 text-slate-500">{p.version}</td>
                  <td className="px-4 py-3">{p.security ? '⚠️ sim' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {logParams && (
        <InstallLogModal
          serverId={serverId}
          op="updates-install"
          params={logParams}
          title={logParams.securityOnly ? 'Instalando atualizações de segurança' : 'Instalando todas as atualizações'}
          onClose={() => setLogParams(null)}
          onDone={() => handleCheck()}
        />
      )}
    </div>
  );
}

interface DockerStatusResp {
  installed: boolean;
  version?: string;
  containers?: DockerContainer[];
}

function DockerTab({ server, onChange }: { server: Server; onChange: () => void }) {
  const [status, setStatus] = useState<DockerStatusResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [containerLoading, setContainerLoading] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<DockerContainer | null>(null);
  const [confirmUninstall, setConfirmUninstall] = useState(false);
  const [showUninstallLog, setShowUninstallLog] = useState(false);
  const [instances, setInstances] = useState<DatabaseInstanceSummary[]>([]);
  const [replicateTarget, setReplicateTarget] = useState<DatabaseInstanceSummary | null>(null);
  const [logsTarget, setLogsTarget] = useState<DockerContainer | null>(null);
  const [cloneTarget, setCloneTarget] = useState<DockerContainer | null>(null);
  const [statusFilter, setStatusFilter] = useState<'active' | 'stopped' | 'all'>('active');
  const [search, setSearch] = useState('');

  function loadStatus() {
    apiFetch<DockerStatusResp>(`/servers/${server.id}/docker/status`)
      .then(setStatus)
      .catch((e) => setError(e.message));
  }

  // ponytail: pra saber quais containers são bancos MySQL geridos pelo Velix
  // (e mostrar o botão de replicação só neles) — casa pelo containerName.
  function loadInstances() {
    apiFetch<DatabaseInstanceSummary[]>(`/servers/${server.id}/databases`).then(setInstances);
  }

  useEffect(() => {
    if (server.dockerInstalled) {
      loadStatus();
      loadInstances();
    }
  }, [server.dockerInstalled]);
  useAutoRefresh(() => server.dockerInstalled && loadStatus(), 10_000);

  async function handleToggle(c: DockerContainer) {
    const running = c.status.toLowerCase().includes('up');
    setContainerLoading(c.id);
    setError(null);
    try {
      await apiFetch(`/servers/${server.id}/docker/containers/${c.id}/${running ? 'stop' : 'start'}`, { method: 'POST' });
      loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Falha ao ${running ? 'parar' : 'iniciar'} container`);
    } finally {
      setContainerLoading(null);
    }
  }

  async function handleRestart(c: DockerContainer) {
    setContainerLoading(c.id);
    setError(null);
    try {
      await apiFetch(`/servers/${server.id}/docker/containers/${c.id}/stop`, { method: 'POST' });
      await apiFetch(`/servers/${server.id}/docker/containers/${c.id}/start`, { method: 'POST' });
      loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao reiniciar container');
    } finally {
      setContainerLoading(null);
    }
  }

  async function handleRemoveConfirmed() {
    if (!confirmRemove) return;
    setContainerLoading(confirmRemove.id);
    try {
      await apiFetch(`/servers/${server.id}/docker/containers/${confirmRemove.id}`, { method: 'DELETE' });
      setConfirmRemove(null);
      loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao remover container');
    } finally {
      setContainerLoading(null);
    }
  }

  if (!server.dockerInstalled) {
    return (
      <div>
        <p className="mb-4 text-sm text-slate-500">Docker ainda não foi instalado neste servidor.</p>
        <button onClick={() => setShowLog(true)} className="btn-primary flex items-center gap-2 px-4 py-2 text-sm">
          <IconDownload className="h-4 w-4" />
          Instalar Docker
        </button>
        {error && (
          <div className="mt-3">
            <Alert variant="error">{error}</Alert>
          </div>
        )}
        {showLog && (
          <InstallLogModal
            serverId={server.id}
            op="docker-install"
            title="Instalando Docker"
            onClose={() => setShowLog(false)}
            onDone={() => {
              onChange();
              loadStatus();
            }}
          />
        )}
      </div>
    );
  }

  const allContainers = status?.containers ?? [];
  const searched = search.trim()
    ? allContainers.filter(
        (c) => stripSwarmSuffix(c.names).toLowerCase().includes(search.toLowerCase()) || c.image.toLowerCase().includes(search.toLowerCase()),
      )
    : allContainers;
  const visibleContainers = searched.filter((c) => {
    const running = c.status.toLowerCase().includes('up');
    if (statusFilter === 'active') return running;
    if (statusFilter === 'stopped') return !running;
    return true;
  });
  const groups = groupContainers(visibleContainers);
  const dbInstances = instances.length;

  const dangerMenu: ActionMenuItem[] = [
    { label: 'Desinstalar Docker', icon: <IconTrash className="h-4 w-4" />, onClick: () => setConfirmUninstall(true), danger: true },
  ];

  return (
    <div className="flex flex-col gap-5 xl:flex-row">
      <div className="min-w-0 flex-1">
        <ModuleHeader
          title="Docker"
          description="Containers, projetos e stacks deste servidor"
          meta={`Versão ${status?.version ?? server.dockerVersion ?? '—'}`}
          actions={
            <button onClick={loadStatus} className="btn-secondary flex items-center gap-1.5 px-3 py-1.5 text-xs">
              <IconRefresh className="h-3.5 w-3.5" />
              Atualizar
            </button>
          }
          menu={dangerMenu}
        />

        {error && (
          <div className="mb-3">
            <Alert variant="error">{error}</Alert>
          </div>
        )}

        <DockerSummary version={status?.version ?? server.dockerVersion ?? undefined} containers={allContainers} />

        <Toolbar
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Buscar por nome ou imagem..."
          resultCount={`${visibleContainers.length} container${visibleContainers.length === 1 ? '' : 's'}`}
          filters={
            <div className="flex gap-1 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800/60">
              {(
                [
                  ['active', 'Ativos'],
                  ['stopped', 'Parados'],
                  ['all', 'Todos'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setStatusFilter(key)}
                  className={`tab-pill px-3 py-1.5 text-xs ${statusFilter === key ? 'tab-pill-active' : ''}`}
                >
                  {label}
                </button>
              ))}
            </div>
          }
        />

        {visibleContainers.length === 0 ? (
          <EmptyState
            icon={<IconBox className="h-5 w-5" />}
            title={search ? 'Nenhum container corresponde à busca' : 'Nenhum container encontrado'}
            description={
              search
                ? 'Ajuste o termo buscado ou limpe o filtro.'
                : statusFilter === 'active'
                  ? 'Nenhum container ativo no momento.'
                  : statusFilter === 'stopped'
                    ? 'Nenhum container parado no momento.'
                    : undefined
            }
            action={
              search ? (
                <button onClick={() => setSearch('')} className="btn-secondary px-3 py-1.5 text-xs">
                  Limpar busca
                </button>
              ) : undefined
            }
          />
        ) : (
          <div className="card divide-y divide-slate-100 overflow-hidden dark:divide-slate-700/80">
            {groups.map((g) => {
              if (g.containers.length === 1) {
                const c = g.containers[0];
                const busy = containerLoading === c.id;
                const instance = instances.find((i) => i.containerName === c.names);
                const isReplica = instance?.role === 'REPLICA';
                return (
                  <ContainerRow
                    key={c.id}
                    container={c}
                    label={stripSwarmSuffix(c.names)}
                    canReplicate={!!instance}
                    isReplica={isReplica}
                    busy={busy}
                    onLogs={() => setLogsTarget(c)}
                    onReplicate={() => instance && setReplicateTarget(instance)}
                    onClone={() => setCloneTarget(c)}
                    onToggle={() => handleToggle(c)}
                    onRestart={() => handleRestart(c)}
                    onRemove={() => setConfirmRemove(c)}
                  />
                );
              }
              const activeCount = g.containers.filter((c) => c.status.toLowerCase().includes('up')).length;
              const groupTone = activeCount === 0 ? 'neutral' : activeCount === g.containers.length ? 'success' : 'warning';
              return (
                <Link
                  key={g.key}
                  href={`/servers/${server.id}/docker-groups/${encodeURIComponent(g.key)}`}
                  className={`row-hover group flex items-center gap-4 border-l-[3px] ${rowStatusBorderClass(groupTone)} py-2.5 pl-3.5 pr-4`}
                >
                  <span className={`icon-chip shrink-0 text-sm font-semibold ${avatarColor(g.key)}`}>{g.key.slice(0, 2).toUpperCase()}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{g.key}</p>
                      <span className="badge shrink-0 bg-sky-500/10 text-sky-600 dark:text-sky-400">Projeto</span>
                    </div>
                    <p className="truncate text-xs text-slate-400">{g.containers.length} containers</p>
                  </div>
                  <span className="badge shrink-0 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">{activeCount}/{g.containers.length} ativos</span>
                  <span className="shrink-0 text-sm text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-indigo-500">→</span>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      <OperationalPanel>
        <OperationalPanelSection title="Serviços do servidor">
          <div className="space-y-2.5 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Docker</span>
              <StatusBadge tone={server.dockerInstalled ? 'success' : 'neutral'}>{server.dockerInstalled ? 'Ativo' : 'Ausente'}</StatusBadge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Traefik</span>
              <StatusBadge tone={server.traefikInstalled ? 'success' : 'neutral'}>{server.traefikInstalled ? 'Ativo' : 'Ausente'}</StatusBadge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Bancos MySQL</span>
              <span className="font-medium tabular-nums">{dbInstances}</span>
            </div>
          </div>
        </OperationalPanelSection>
      </OperationalPanel>

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

      {confirmUninstall && (
        <ConfirmModal
          title="Desinstalar Docker"
          message="Isso remove o Docker Engine e todos os containers deste servidor — incluindo Traefik e bancos MySQL geridos pelo Velix. Essa ação não pode ser desfeita."
          confirmLabel="Desinstalar"
          danger
          onConfirm={() => {
            setConfirmUninstall(false);
            setShowUninstallLog(true);
          }}
          onCancel={() => setConfirmUninstall(false)}
        />
      )}

      {showUninstallLog && (
        <InstallLogModal
          serverId={server.id}
          op="docker-uninstall"
          title="Desinstalando Docker"
          onClose={() => setShowUninstallLog(false)}
          onDone={() => {
            onChange();
            setStatus(null);
          }}
        />
      )}

      {replicateTarget && (
        <QuickReplicateModal
          instance={replicateTarget}
          currentServerId={server.id}
          onClose={() => setReplicateTarget(null)}
          onCreated={() => {
            setReplicateTarget(null);
            loadInstances();
          }}
        />
      )}

      {logsTarget && (
        <ContainerLogsModal
          serverId={server.id}
          containerId={logsTarget.id}
          title={logsTarget.names}
          running={logsTarget.status.toLowerCase().includes('up')}
          busy={containerLoading === logsTarget.id}
          onToggle={() => handleToggle(logsTarget)}
          onRemove={() => {
            setConfirmRemove(logsTarget);
            setLogsTarget(null);
          }}
          onClose={() => setLogsTarget(null)}
        />
      )}

      {cloneTarget && (
        <CloneContainerModal
          sourceServerId={server.id}
          container={cloneTarget}
          onClose={() => setCloneTarget(null)}
          onCloned={() => setCloneTarget(null)}
        />
      )}

    </div>
  );
}

interface TraefikStatusResp {
  /** Traefik de terceiros nas portas 80/443 — não dá pra usar nem instalar. */
  foreignTraefik?: boolean;
  /** É o Traefik do próprio Velix, já servindo as aplicações do painel. */
  sharedWithPanel?: boolean;
  installed: boolean;
  dockerInstalled: boolean;
  cloudflareConnected: boolean;
  version?: string | null;
  running?: boolean;
  network?: string;
  ports?: { http: number; https: number };
  publicIp?: string | null;
  domainsCount?: number;
  statusText?: string | null;
}

interface DomainRow {
  id: string;
  hostname: string;
  targetPort: number;
  createDnsRecord: boolean;
  cloudflareRecordId: string | null;
  status: 'PENDING' | 'ACTIVE' | 'ERROR';
  lastError: string | null;
  lastCheckedAt: string | null;
}

const DOMAIN_TONE: Record<DomainRow['status'], StatusTone> = {
  PENDING: 'warning',
  ACTIVE: 'success',
  ERROR: 'danger',
};

function LibraryTab({ server }: { server: Server }) {
  const [apps, setApps] = useState<CatalogApplicationSummary[] | null>(null);
  const [search, setSearch] = useState('');
  const wizard = useInstallWizard();

  useEffect(() => {
    apiFetch<CatalogApplicationSummary[]>('/catalog/applications').then(setApps);
  }, []);

  const visible = (apps ?? []).filter((a) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q) || a.category.toLowerCase().includes(q);
  });

  return (
    <div>
      <ModuleHeader title="Biblioteca" description="Catálogo do Velix — veja os detalhes e implante com um assistente guiado (rede, volumes e, se quiser, domínio com HTTPS)." />

      <Toolbar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Buscar aplicações..."
        resultCount={apps ? `${visible.length} aplicaç${visible.length === 1 ? 'ão' : 'ões'}` : undefined}
      />

      {apps === null ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-[104px]" />
          <Skeleton className="h-[104px]" />
          <Skeleton className="h-[104px]" />
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<IconSearch className="h-5 w-5" />}
          title={search ? 'Nenhuma aplicação corresponde à busca' : 'Catálogo vazio'}
          action={search ? <button onClick={() => setSearch('')} className="btn-secondary px-3 py-1.5 text-xs">Limpar busca</button> : undefined}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((app) => (
            <CompactAppCard
              key={app.slug}
              app={app}
              serverId={server.id}
              onInstall={wizard.open}
              installLoading={wizard.loadingSlug === app.slug}
            />
          ))}
        </div>
      )}

      {wizard.target && <DeployWizard manifest={wizard.target} preselectedServerId={server.id} onClose={wizard.close} />}
    </div>
  );
}

interface ApplicationDomain {
  id: string;
  hostname: string;
  serviceName: string | null;
  targetPort: number;
  createDnsRecord: boolean;
  status: 'PENDING' | 'ACTIVE' | 'ERROR';
  lastError: string | null;
}

interface ProjectRow {
  id: string;
  name: string;
  slug: string;
  status: 'EMPTY' | 'DEPLOYING' | 'RUNNING' | 'STOPPED' | 'ERROR' | 'REMOVING';
  lastError: string | null;
  deployedAt: string;
  domains: ApplicationDomain[];
  deployments: { sourceType: string; manifestSlug: string | null }[];
}

const APP_STATUS_TONE: Record<ProjectRow['status'], StatusTone> = {
  EMPTY: 'neutral',
  DEPLOYING: 'info',
  RUNNING: 'success',
  STOPPED: 'neutral',
  ERROR: 'danger',
  REMOVING: 'warning',
};

function ApplicationsTab({ server, onGoToLibrary }: { server: Server; onGoToLibrary?: () => void }) {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<ProjectRow | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  function load() {
    apiFetch<ProjectRow[]>(`/servers/${server.id}/applications`)
      .then(setProjects)
      .catch((e) => setError(e.message));
  }

  useEffect(load, [server.id]);
  useAutoRefresh(load, 15_000);

  async function handleRemoveConfirmed() {
    if (!confirmRemove) return;
    setBusy(confirmRemove.id);
    try {
      await apiFetch(`/applications/${confirmRemove.id}`, { method: 'DELETE' });
      setConfirmRemove(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao remover projeto');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <ModuleHeader
        title="Projetos"
        description="Projetos implantados pelo Velix neste servidor"
        actions={
          <button onClick={() => setShowCreate(true)} className="btn-primary px-3.5 py-2 text-sm">
            Novo projeto
          </button>
        }
      />

      {error && (
        <div className="mb-3">
          <Alert variant="error">{error}</Alert>
        </div>
      )}

      {projects === null ? (
        <div className="card divide-y divide-slate-100 overflow-hidden dark:divide-slate-700">
          <SkeletonRow />
          <SkeletonRow />
        </div>
      ) : projects.length === 0 ? (
        <EmptyState
          icon={<IconLayoutGrid className="h-5 w-5" />}
          title="Nenhum projeto ainda"
          description="Crie um projeto e implante um serviço nele — do catálogo (Biblioteca) ou do seu próprio repositório."
          action={
            <div className="flex items-center gap-2">
              <button onClick={() => setShowCreate(true)} className="btn-primary px-3.5 py-2 text-sm">
                Novo projeto
              </button>
              {onGoToLibrary && (
                <button onClick={onGoToLibrary} className="btn-secondary px-3.5 py-2 text-sm">
                  Ir para Biblioteca
                </button>
              )}
            </div>
          }
        />
      ) : (
        <div className="card divide-y divide-slate-100 overflow-hidden dark:divide-slate-700">
          {projects.map((project) => {
            const busyNow = busy === project.id;
            const primaryDomain = project.domains[0];
            const actionItems: ActionMenuItem[] = [
              { label: 'Abrir projeto', icon: <IconLayoutGrid className="h-4 w-4" />, onClick: () => router.push(`/projects/${project.id}`) },
              { label: 'Remover projeto', icon: <IconTrash className="h-4 w-4" />, onClick: () => setConfirmRemove(project), danger: true, disabled: busyNow },
            ];
            return (
              <div
                key={project.id}
                className={`row-hover flex items-center gap-3 border-l-[3px] ${rowStatusBorderClass(APP_STATUS_TONE[project.status])} py-2.5 pl-3.5 pr-4`}
              >
                <button
                  onClick={() => router.push(`/projects/${project.id}`)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-sm font-semibold text-indigo-600 dark:text-indigo-400">
                    {project.name.charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{project.name}</p>
                    </div>
                    <p className="truncate text-xs text-slate-400">
                      {project.deployments.length} serviço{project.deployments.length === 1 ? '' : 's'}
                      {project.lastError ? ` · ${project.lastError}` : ''}
                    </p>
                  </div>
                </button>
                {primaryDomain && (
                  <div className="hidden shrink-0 sm:block">
                    <RowStatusLabel tone={DOMAIN_TONE[primaryDomain.status]}>
                      <span className="font-mono normal-case tracking-normal">{primaryDomain.hostname}</span>
                    </RowStatusLabel>
                  </div>
                )}
                {primaryDomain && primaryDomain.status === 'ACTIVE' && (
                  <a
                    href={`https://${primaryDomain.hostname}`}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-ghost hidden shrink-0 px-2.5 py-1.5 text-xs md:inline-flex"
                  >
                    Abrir
                  </a>
                )}
                <ActionMenu items={actionItems} />
              </div>
            );
          })}
        </div>
      )}

      {confirmRemove && (
        <ConfirmModal
          title="Remover projeto"
          message={`Remover "${confirmRemove.name}"? Todos os containers e volumes dos serviços deste projeto são apagados. Essa ação não pode ser desfeita.`}
          confirmLabel="Remover"
          danger
          loading={busy === confirmRemove.id}
          onConfirm={handleRemoveConfirmed}
          onCancel={() => setConfirmRemove(null)}
        />
      )}

      {showCreate && (
        <CreateProjectModal
          defaultServerId={server.id}
          onClose={() => setShowCreate(false)}
          onCreated={(id) => router.push(`/projects/${id}`)}
        />
      )}
    </div>
  );
}

const ACME_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const ACME_INVALID_TLDS = new Set(['local', 'test', 'localhost', 'internal', 'lan', 'example']);

function isValidAcmeEmailClient(email: string): boolean {
  const trimmed = email.trim();
  if (!ACME_EMAIL_PATTERN.test(trimmed)) return false;
  const tld = trimmed.split('.').pop()?.toLowerCase() ?? '';
  return !ACME_INVALID_TLDS.has(tld);
}

/** Coleta o e-mail de contato do Let's Encrypt antes de instalar — sem isso o
 * Traefik usava um valor padrão inválido e TODA emissão de certificado falhava
 * silenciosamente depois (bug real, encontrado testando esse fluxo). */
function InstallTraefikModal({ onClose, onConfirm }: { onClose: () => void; onConfirm: (acmeEmail: string) => void }) {
  const [email, setEmail] = useState('');
  const valid = isValidAcmeEmailClient(email);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (valid) onConfirm(email.trim());
  }

  return (
    <Modal title="Instalar Traefik" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <label className="mb-1 block text-sm">
          <span className="mb-1 block font-medium">E-mail de contato (Let&apos;s Encrypt)</span>
          <input
            required
            type="email"
            placeholder="voce@seudominio.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input"
          />
        </label>
        <p className="mb-3 text-xs text-slate-400">
          Usado pelo Let&apos;s Encrypt só pra avisos de expiração de certificado — precisa de um domínio público de verdade (não aceita ex.: admin@velix.local).
        </p>
        {email && !valid && (
          <div className="mb-3">
            <Alert variant="error">E-mail inválido — use um domínio público real.</Alert>
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
            Cancelar
          </button>
          <button type="submit" disabled={!valid} className="btn-primary px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50">
            Continuar
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ProxyTab({ server, onChange }: { server: Server; onChange: () => void }) {
  const [status, setStatus] = useState<TraefikStatusResp | null>(null);
  const [domains, setDomains] = useState<DomainRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showInstallForm, setShowInstallForm] = useState(false);
  const [showInstall, setShowInstall] = useState<string | null>(null);
  const [confirmUninstall, setConfirmUninstall] = useState(false);
  const [showUninstallLog, setShowUninstallLog] = useState(false);
  const [showAddDomain, setShowAddDomain] = useState(false);
  const [domainBusy, setDomainBusy] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<DomainRow | null>(null);
  const [search, setSearch] = useState('');
  const [showTraefikLogs, setShowTraefikLogs] = useState(false);

  function loadStatus() {
    apiFetch<TraefikStatusResp>(`/servers/${server.id}/traefik/status`)
      .then(setStatus)
      .catch((e) => setError(e.message));
  }
  function loadDomains() {
    apiFetch<DomainRow[]>(`/servers/${server.id}/domains`)
      .then(setDomains)
      .catch(() => setDomains([]));
  }

  useEffect(() => {
    if (server.dockerInstalled) {
      loadStatus();
      loadDomains();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server.id]);
  useAutoRefresh(() => server.dockerInstalled && loadStatus(), 15_000);

  async function handleVerify(d: DomainRow) {
    setDomainBusy(d.id);
    try {
      await apiFetch(`/domains/${d.id}/verify`);
      loadDomains();
    } finally {
      setDomainBusy(null);
    }
  }

  async function handleRemoveConfirmed() {
    if (!confirmRemove) return;
    setDomainBusy(confirmRemove.id);
    try {
      await apiFetch(`/domains/${confirmRemove.id}`, { method: 'DELETE' });
      setConfirmRemove(null);
      loadDomains();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao remover domínio');
    } finally {
      setDomainBusy(null);
    }
  }

  if (!server.dockerInstalled) {
    return <p className="text-sm text-slate-500">Instale o Docker (aba Docker) antes de configurar o proxy e domínios.</p>;
  }

  // Traefik ainda não instalado → tela de instalação
  if (status && !status.installed) {
    return (
      <div>
        <ModuleHeader title="Proxy e domínios" description="Traefik nativo do Velix — proxy reverso, HTTPS e domínios" />
        {!status.cloudflareConnected ? (
          <EmptyState
            icon={<IconGlobe className="h-5 w-5" />}
            title="Conecte a Cloudflare primeiro"
            description="O SSL automático (Let's Encrypt via DNS-01) precisa de uma conta Cloudflare conectada. Configure em Configurações."
            action={
              <Link href="/settings" className="btn-secondary px-3.5 py-2 text-sm">
                Abrir Configurações
              </Link>
            }
          />
        ) : (
          status.foreignTraefik ? (
            <EmptyState
              icon={<IconShield className="h-5 w-5" />}
              title="As portas 80 e 443 já estão ocupadas"
              description={
                server.isLocal
                  ? 'Há um proxy nas portas 80/443 que não é o do Velix. Se você instalou o Velix com domínio, rode o instalador novamente para que o Traefik dele passe a atender também as aplicações do painel.'
                  : 'Há um proxy nas portas 80/443 que não foi instalado pelo Velix. Libere-as antes de instalar o Traefik do painel.'
              }
            />
          ) : (
            <EmptyState
              icon={<IconShield className="h-5 w-5" />}
              title="Traefik não instalado"
              description="Instale o Traefik para publicar aplicações com domínio próprio e HTTPS automático. Ele ocupa as portas 80 e 443 e cria a rede velix-proxy."
              action={
                <button onClick={() => setShowInstallForm(true)} className="btn-primary flex items-center gap-2 px-3.5 py-2 text-sm">
                  <IconDownload className="h-4 w-4" />
                  Instalar Traefik
                </button>
              }
            />
          )
        )}
        {error && (
          <div className="mt-3">
            <Alert variant="error">{error}</Alert>
          </div>
        )}
        {showInstallForm && (
          <InstallTraefikModal
            onClose={() => setShowInstallForm(false)}
            onConfirm={(acmeEmail) => {
              setShowInstallForm(false);
              setShowInstall(acmeEmail);
            }}
          />
        )}
        {showInstall && (
          <InstallLogModal
            serverId={server.id}
            op="traefik-install"
            params={{ acmeEmail: showInstall }}
            title="Instalando Traefik"
            onClose={() => setShowInstall(null)}
            onDone={() => {
              onChange();
              loadStatus();
            }}
          />
        )}
      </div>
    );
  }

  const visibleDomains = (domains ?? []).filter(
    (d) => !search.trim() || d.hostname.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="flex flex-col gap-5 xl:flex-row">
      <div className="min-w-0 flex-1">
        <ModuleHeader
          title="Proxy e domínios"
          description="Traefik nativo do Velix — proxy reverso, HTTPS e domínios"
          meta={status ? `Versão ${status.version ?? '—'} · rede ${status.network} · portas ${status.ports?.http}/${status.ports?.https}` : undefined}
          actions={
            <>
              <button onClick={() => setShowAddDomain(true)} className="btn-primary flex items-center gap-1.5 px-3 py-1.5 text-xs">
                <IconPlus className="h-3.5 w-3.5" />
                Adicionar domínio
              </button>
              <button onClick={() => setShowTraefikLogs(true)} className="btn-secondary flex items-center gap-1.5 px-3 py-1.5 text-xs">
                <IconTerminal className="h-3.5 w-3.5" />
                Logs do Traefik
              </button>
              <button onClick={loadStatus} className="btn-secondary flex items-center gap-1.5 px-3 py-1.5 text-xs">
                <IconRefresh className="h-3.5 w-3.5" />
                Atualizar
              </button>
            </>
          }
          menu={
            status?.sharedWithPanel
              ? []
              : [{ label: 'Desinstalar Traefik', icon: <IconTrash className="h-4 w-4" />, onClick: () => setConfirmUninstall(true), danger: true }]
          }
        />

        {error && (
          <div className="mb-3">
            <Alert variant="error">{error}</Alert>
          </div>
        )}

        <Toolbar
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Buscar domínio..."
          resultCount={`${visibleDomains.length} domínio${visibleDomains.length === 1 ? '' : 's'}`}
        />

        {domains === null ? (
          <div className="card divide-y divide-slate-100 overflow-hidden dark:divide-slate-700">
            <SkeletonRow />
            <SkeletonRow />
          </div>
        ) : visibleDomains.length === 0 ? (
          <EmptyState
            icon={<IconGlobe className="h-5 w-5" />}
            title={search ? 'Nenhum domínio corresponde à busca' : 'Nenhum domínio configurado'}
            description={search ? undefined : 'Adicione um domínio apontando para uma porta publicada neste servidor — o Velix cria a rota no Traefik e emite o certificado.'}
            action={
              search ? undefined : (
                <button onClick={() => setShowAddDomain(true)} className="btn-primary flex items-center gap-2 px-3.5 py-2 text-sm">
                  <IconPlus className="h-4 w-4" />
                  Adicionar domínio
                </button>
              )
            }
          />
        ) : (
          <div className="card divide-y divide-slate-100 overflow-hidden dark:divide-slate-700">
            {visibleDomains.map((d) => (
              <div key={d.id} className={`row-hover flex items-center gap-3 border-l-[3px] ${rowStatusBorderClass(DOMAIN_TONE[d.status])} py-2.5 pl-3.5 pr-4`}>
                <IconGlobe className="h-4 w-4 shrink-0 text-slate-400" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-mono text-sm font-medium text-slate-900 dark:text-slate-100">{d.hostname}</p>
                  </div>
                  <p className="truncate font-mono text-xs text-slate-400">
                    → porta {d.targetPort}
                    {d.createDnsRecord ? ' · DNS Cloudflare' : ''}
                    {d.lastError ? ` · ${d.lastError}` : ''}
                  </p>
                </div>
                <a
                  href={`https://${d.hostname}`}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-ghost hidden shrink-0 px-2.5 py-1.5 text-xs sm:inline-flex"
                >
                  Abrir
                </a>
                <ActionMenu
                  items={[
                    { label: 'Verificar agora', icon: <IconRefresh className="h-4 w-4" />, onClick: () => handleVerify(d), disabled: domainBusy === d.id },
                    { label: 'Remover domínio', icon: <IconTrash className="h-4 w-4" />, onClick: () => setConfirmRemove(d), danger: true, disabled: domainBusy === d.id },
                  ]}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      <OperationalPanel>
        <OperationalPanelSection title="Estado do proxy">
          <div className="space-y-2.5 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Traefik</span>
              <StatusBadge tone={status?.running ? 'success' : 'neutral'}>{status?.running ? 'Rodando' : 'Parado'}</StatusBadge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Cloudflare</span>
              <StatusBadge tone={status?.cloudflareConnected ? 'success' : 'warning'}>{status?.cloudflareConnected ? 'Conectado' : 'Ausente'}</StatusBadge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">IP público</span>
              <span className="font-mono text-xs">{status?.publicIp ?? '—'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Domínios</span>
              <span className="font-medium tabular-nums">{domains?.length ?? 0}</span>
            </div>
          </div>
        </OperationalPanelSection>
      </OperationalPanel>

      {showAddDomain && (
        <AddDomainModal
          serverId={server.id}
          cloudflareConnected={!!status?.cloudflareConnected}
          onClose={() => setShowAddDomain(false)}
          onCreated={() => {
            setShowAddDomain(false);
            loadDomains();
            loadStatus();
          }}
        />
      )}

      {showTraefikLogs && (
        <ContainerLogsModal
          serverId={server.id}
          containerId="velix-traefik"
          title="Logs do Traefik"
          onClose={() => setShowTraefikLogs(false)}
        />
      )}

      {confirmRemove && (
        <ConfirmModal
          title="Remover domínio"
          message={`Remover "${confirmRemove.hostname}"? A rota é apagada do Traefik${confirmRemove.cloudflareRecordId ? ' e o registro DNS criado pelo Velix é removido da Cloudflare' : ''}.`}
          confirmLabel="Remover"
          danger
          loading={domainBusy === confirmRemove.id}
          onConfirm={handleRemoveConfirmed}
          onCancel={() => setConfirmRemove(null)}
        />
      )}

      {confirmUninstall && (
        <ConfirmModal
          title="Desinstalar Traefik"
          message="Isso remove o Traefik e a configuração em /opt/velix/traefik. Domínios param de responder até reinstalar. Essa ação não pode ser desfeita."
          confirmLabel="Desinstalar"
          danger
          onConfirm={() => {
            setConfirmUninstall(false);
            setShowUninstallLog(true);
          }}
          onCancel={() => setConfirmUninstall(false)}
        />
      )}

      {showUninstallLog && (
        <InstallLogModal
          serverId={server.id}
          op="traefik-uninstall"
          title="Desinstalando Traefik"
          onClose={() => setShowUninstallLog(false)}
          onDone={() => {
            onChange();
            loadStatus();
          }}
        />
      )}
    </div>
  );
}

function AddDomainModal({
  serverId,
  cloudflareConnected,
  onClose,
  onCreated,
}: {
  serverId: string;
  cloudflareConnected: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({ hostname: '', targetPort: 8080, createDnsRecord: cloudflareConnected });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/servers/${serverId}/domains`, { method: 'POST', body: JSON.stringify(form) });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao adicionar domínio');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Adicionar domínio" onClose={onClose} closeDisabled={saving}>
      <form onSubmit={handleSubmit}>
        <label className="mb-3 block text-sm">
          <span className="mb-1 block font-medium">Domínio</span>
          <input
            required
            placeholder="app.seudominio.com"
            value={form.hostname}
            onChange={(e) => setForm({ ...form, hostname: e.target.value })}
            className="input"
          />
        </label>
        <label className="mb-3 block text-sm">
          <span className="mb-1 block font-medium">Porta de destino (publicada no servidor)</span>
          <input
            required
            type="number"
            min={1}
            max={65535}
            value={form.targetPort}
            onChange={(e) => setForm({ ...form, targetPort: Number(e.target.value) })}
            className="input"
          />
          <span className="mt-1 block text-xs text-slate-400">
            O Traefik encaminha o domínio para essa porta no host (ex.: um container com -p 8080:8080).
          </span>
        </label>
        <label className={`flex items-center gap-2 text-sm ${cloudflareConnected ? '' : 'opacity-50'}`}>
          <input
            type="checkbox"
            disabled={!cloudflareConnected}
            checked={form.createDnsRecord}
            onChange={(e) => setForm({ ...form, createDnsRecord: e.target.checked })}
          />
          Criar registro DNS na Cloudflare automaticamente
        </label>
        {!cloudflareConnected && <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">Cloudflare não conectado — crie o registro DNS manualmente.</p>}
        {error && (
          <div className="mt-3">
            <Alert variant="error">{error}</Alert>
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800">
            Cancelar
          </button>
          <button type="submit" disabled={saving} className="btn-primary px-4 py-2 text-sm">
            {saving ? 'Adicionando...' : 'Adicionar domínio'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function TerminalTab({ serverId }: { serverId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<import('@xterm/xterm').Terminal | null>(null);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'closed' | 'error'>('connecting');
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = getTerminalTheme(isDark);
  }, [isDark]);

  useEffect(() => {
    let disposed = false;
    let ws: WebSocket | null = null;
    let term: import('@xterm/xterm').Terminal | null = null;
    let resizeObserver: ResizeObserver | null = null;

    async function start() {
      const { Terminal } = await import('@xterm/xterm');
      const { FitAddon } = await import('@xterm/addon-fit');
      if (disposed || !containerRef.current) return;

      term = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        lineHeight: 1.4,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        theme: getTerminalTheme(isDark),
      });
      termRef.current = term;
      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(containerRef.current);
      fitAddon.fit();

      const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${protocol}://${location.host}/terminal?serverId=${serverId}&token=${getToken()}`);

      ws.onopen = () => setStatus('connected');
      ws.onclose = () => setStatus('closed');
      ws.onerror = () => setStatus('error');
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'data') term?.write(msg.data);
        else if (msg.type === 'error') term?.write(`\r\n\x1b[31m${msg.message}\x1b[0m\r\n`);
        else if (msg.type === 'closed') term?.write('\r\n\x1b[33mConexão encerrada.\x1b[0m\r\n');
      };

      term.onData((data) => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: 'input', data })));

      const sendResize = () => {
        fitAddon.fit();
        if (ws?.readyState === WebSocket.OPEN && term) {
          ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
        }
      };
      resizeObserver = new ResizeObserver(sendResize);
      resizeObserver.observe(containerRef.current);
    }

    start();

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      ws?.close();
      term?.dispose();
      termRef.current = null;
    };
  }, [serverId]);

  const STATUS_DOT: Record<typeof status, string> = {
    connecting: 'bg-slate-500 animate-pulse',
    connected: 'bg-green-400',
    closed: 'bg-slate-500',
    error: 'bg-red-400',
  };

  return (
    <TerminalWindow
      title="Terminal SSH"
      statusSlot={
        <span className="flex items-center gap-1.5 text-xs text-slate-400">
          <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} />
          {status === 'connecting' && 'Conectando...'}
          {status === 'connected' && 'Conectado'}
          {status === 'closed' && 'Desconectado'}
          {status === 'error' && 'Falha na conexão do terminal'}
        </span>
      }
      bodyClassName="p-3"
    >
      <div ref={containerRef} className="h-[70vh] overflow-hidden" />
    </TerminalWindow>
  );
}

