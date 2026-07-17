'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiFetch, getToken } from '@/lib/api';
import { useAutoRefresh } from '@/lib/useAutoRefresh';
import { useInstallWizard } from '@/lib/useInstallWizard';
import { TERMINAL_THEME } from '@/lib/terminalTheme';
import { type DockerContainer, groupContainers, avatarColor, stripSwarmSuffix } from '@/lib/containerGroups';
import type { DatabaseInstanceSummary, CatalogApplicationSummary, CatalogApplicationDetail, ProjectService } from '@/lib/types';
import { Bar } from '@/components/Bar';
import { Alert } from '@/components/Alert';
import { AppIcon } from '@/components/AppIcon';
import { CompactAppCard } from '@/components/CompactAppCard';
import { DeployWizard } from '@/components/DeployWizard';
import { InstallLogModal, OpsLogPanel, type OpsLogStatus } from '@/components/InstallLogModal';
import { Modal, ConfirmModal } from '@/components/Modal';
import { ServerFormModal } from '@/components/ServerFormModal';
import { Sparkline } from '@/components/Sparkline';
import { MetricHistoryModal } from '@/components/MetricHistoryModal';
import { ContainerLogsModal } from '@/components/ContainerLogsModal';
import { CloneContainerModal } from '@/components/CloneContainerModal';
import { QuickReplicateModal } from '@/components/QuickReplicateModal';
import { ContainerRow } from '@/components/ContainerRow';
import { MetricCard } from '@/components/MetricCard';
import { StatusBadge, CapabilityBadge, type StatusTone } from '@/components/StatusBadge';
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
  metrics: ServerMetrics | null;
  metricsCheckedAt: string | null;
  lastCheckedAt: string | null;
}

type TabKey = 'overview' | 'updates' | 'docker' | 'applications' | 'library' | 'proxy' | 'databases' | 'terminal';

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
      { key: 'applications', label: 'Aplicações', icon: <IconLayoutGrid /> },
      { key: 'library', label: 'Biblioteca', icon: <IconStore /> },
      { key: 'proxy', label: 'Proxy e domínios', icon: <IconGlobe /> },
      { key: 'databases', label: 'Bancos', icon: <IconDisk /> },
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
            {server.sshUser}@{server.publicIp ?? server.privateIp ?? server.hostname}:{server.sshPort}
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
          {tab === 'databases' && <DatabasesTab server={server} />}
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
  const [expandedMetric, setExpandedMetric] = useState<'load' | 'mem' | 'disk' | null>(null);

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

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="section-title">Métricas</h2>
        <button onClick={collectMetrics} disabled={collecting} className="btn-secondary px-3 py-1.5 text-xs">
          {collecting ? 'Atualizando...' : '↻ Atualizar agora'}
        </button>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <MetricCard icon={<IconServer className="h-4 w-4" />} chipClassName="bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400" label="Sistema operacional">
          <p className="truncate text-xl font-bold tracking-tight">{server.osName ? `${server.osName} ${server.osVersion ?? ''}` : '—'}</p>
        </MetricCard>

        <MetricCard icon={<IconClock className="h-4 w-4" />} chipClassName="bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-400" label="Uptime">
          <p className="text-xl font-bold tracking-tight">{server.metrics?.uptimeText ?? '—'}</p>
        </MetricCard>

        <MetricCard
          icon={<IconActivity className="h-4 w-4" />}
          chipClassName="bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-400"
          label="Load average"
          onClick={() => setExpandedMetric('load')}
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
          onClick={() => setExpandedMetric('mem')}
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
          onClick={() => setExpandedMetric('disk')}
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

      {expandedMetric && (
        <MetricHistoryModal
          serverId={server.id}
          metric={expandedMetric}
          label={expandedMetric === 'load' ? 'Load average' : expandedMetric === 'mem' ? 'Memória' : 'Disco'}
          unit={expandedMetric === 'load' ? '' : '%'}
          colorClass={
            expandedMetric === 'load'
              ? 'text-violet-500 dark:text-violet-400'
              : expandedMetric === 'mem'
                ? 'text-amber-500 dark:text-amber-400'
                : 'text-teal-500 dark:text-teal-400'
          }
          onClose={() => setExpandedMetric(null)}
        />
      )}

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-2">
        <div className="card p-5">
          <h2 className="section-title mb-3">Ações</h2>
          <div className="flex flex-wrap gap-2">
            <button onClick={handleTest} disabled={testing} className="btn-primary flex items-center gap-2 px-4 py-2 text-sm">
              <IconPlug className="h-4 w-4" />
              {testing ? 'Testando conexão...' : 'Testar conexão'}
            </button>

            {!rebootConfirm ? (
              <button onClick={() => setRebootConfirm(true)} className="btn-danger px-4 py-2 text-sm">
                Reiniciar servidor
              </button>
            ) : (
              <div className="flex items-center gap-2 rounded-lg border border-red-300 px-3 py-1.5 text-sm dark:border-red-800">
                <span className="text-red-600 dark:text-red-400">Confirma o reboot?</span>
                <button onClick={handleReboot} disabled={rebooting} className="btn-danger px-3 py-1 text-xs">
                  {rebooting ? 'Enviando...' : 'Sim, reiniciar'}
                </button>
                <button onClick={() => setRebootConfirm(false)} className="text-xs text-slate-500 hover:underline">
                  Cancelar
                </button>
              </div>
            )}
          </div>

          {result && (
            <div className="mt-4">
              <Alert variant={result.ok ? 'success' : 'error'}>{result.message}</Alert>
            </div>
          )}
          {rebootMessage && (
            <div className="mt-4">
              <Alert variant="info">{rebootMessage}</Alert>
            </div>
          )}
        </div>

        <div className="card p-5">
          <h2 className="section-title mb-2">Domínios Cloudflare</h2>
          <p className="mb-3 text-sm text-slate-500">Localiza registros DNS que apontam para o IP público deste servidor.</p>
          <button
            onClick={handleLookupDomains}
            disabled={lookingUp}
            className="btn-secondary px-4 py-2 text-sm"
          >
            {lookingUp ? 'Buscando...' : 'Localizar domínios'}
          </button>

          {domainsError && (
            <div className="mt-3">
              <Alert variant="error">{domainsError}</Alert>
            </div>
          )}

          {domains && (
            <ul className="mt-3 space-y-1 text-sm">
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
          )}
        </div>
      </div>
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
              return (
                <Link
                  key={g.key}
                  href={`/servers/${server.id}/projects/${encodeURIComponent(g.key)}`}
                  className="row-hover group flex items-center gap-4 px-4 py-3"
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

const DOMAIN_LABEL: Record<DomainRow['status'], string> = {
  PENDING: 'Aguardando SSL',
  ACTIVE: 'Ativo',
  ERROR: 'Erro',
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

interface ApplicationRow {
  id: string;
  name: string;
  slug: string;
  manifestSlug: string;
  manifestVersion: string;
  status: 'DEPLOYING' | 'RUNNING' | 'STOPPED' | 'ERROR' | 'REMOVING';
  containerNames: string[];
  lastError: string | null;
  deployedAt: string;
  domains: ApplicationDomain[];
}

interface EndpointPort {
  port: number;
  protocol: string;
  recommended: boolean;
  source: 'template' | 'container';
}

interface EndpointServiceInfo {
  serviceName: string;
  containerName: string;
  image: string;
  running: boolean;
  ports: EndpointPort[];
}

interface DnsCheckResult {
  state: 'NOT_CONFIGURED' | 'CORRECT' | 'INCORRECT';
  records: string[];
  expectedIp: string | null;
}

interface CertificateInfo {
  state: 'ACTIVE' | 'EXPIRING' | 'NOT_FOUND' | 'ERROR';
  issuer?: string;
  validTo?: string;
  daysRemaining?: number;
  error?: string;
}

const APP_STATUS_TONE: Record<ApplicationRow['status'], StatusTone> = {
  DEPLOYING: 'info',
  RUNNING: 'success',
  STOPPED: 'neutral',
  ERROR: 'danger',
  REMOVING: 'warning',
};

const APP_STATUS_LABEL: Record<ApplicationRow['status'], string> = {
  DEPLOYING: 'Implantando',
  RUNNING: 'Ativo',
  STOPPED: 'Parado',
  ERROR: 'Erro',
  REMOVING: 'Removendo',
};

function ApplicationsTab({ server, onGoToLibrary }: { server: Server; onGoToLibrary?: () => void }) {
  const [apps, setApps] = useState<ApplicationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<ApplicationRow | null>(null);
  const [domainsFor, setDomainsFor] = useState<ApplicationRow | null>(null);
  const [credentialsFor, setCredentialsFor] = useState<ApplicationRow | null>(null);
  const [servicesFor, setServicesFor] = useState<ApplicationRow | null>(null);

  function load() {
    apiFetch<ApplicationRow[]>(`/servers/${server.id}/applications`)
      .then(setApps)
      .catch((e) => setError(e.message));
  }

  useEffect(load, [server.id]);
  useAutoRefresh(load, 15_000);

  async function handleAction(app: ApplicationRow, action: 'start' | 'stop' | 'restart') {
    setBusy(app.id);
    setError(null);
    try {
      await apiFetch(`/applications/${app.id}/${action}`, { method: 'POST' });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao executar ação');
    } finally {
      setBusy(null);
    }
  }

  async function handleRemoveConfirmed() {
    if (!confirmRemove) return;
    setBusy(confirmRemove.id);
    try {
      await apiFetch(`/applications/${confirmRemove.id}`, { method: 'DELETE' });
      setConfirmRemove(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao remover aplicação');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <ModuleHeader title="Aplicações" description="Aplicações implantadas pelo Velix neste servidor" />

      {error && (
        <div className="mb-3">
          <Alert variant="error">{error}</Alert>
        </div>
      )}

      {apps === null ? (
        <div className="card divide-y divide-slate-100 overflow-hidden dark:divide-slate-700">
          <SkeletonRow />
          <SkeletonRow />
        </div>
      ) : apps.length === 0 ? (
        <EmptyState
          icon={<IconLayoutGrid className="h-5 w-5" />}
          title="Nenhuma aplicação implantada ainda"
          description="Implante uma aplicação a partir da Biblioteca."
          action={
            onGoToLibrary ? (
              <button onClick={onGoToLibrary} className="btn-primary px-3.5 py-2 text-sm">
                Ir para Biblioteca
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="card divide-y divide-slate-100 overflow-hidden dark:divide-slate-700">
          {apps.map((app) => {
            const busyNow = busy === app.id;
            const running = app.status === 'RUNNING';
            const primaryDomain = app.domains[0];
            const actionItems: ActionMenuItem[] = [
              { label: 'Ver serviços', icon: <IconLayers className="h-4 w-4" />, onClick: () => setServicesFor(app) },
              { label: 'Gerenciar domínios', icon: <IconGlobe className="h-4 w-4" />, onClick: () => setDomainsFor(app) },
              { label: 'Ver credenciais', icon: <IconKey className="h-4 w-4" />, onClick: () => setCredentialsFor(app) },
              ...(running
                ? [
                    { label: 'Reiniciar', icon: <IconRefresh className="h-4 w-4" />, onClick: () => handleAction(app, 'restart'), disabled: busyNow },
                    { label: 'Parar', icon: <IconPower className="h-4 w-4" />, onClick: () => handleAction(app, 'stop'), disabled: busyNow },
                  ]
                : [{ label: 'Iniciar', icon: <IconPower className="h-4 w-4" />, onClick: () => handleAction(app, 'start'), disabled: busyNow }]),
              { label: 'Remover aplicação', icon: <IconTrash className="h-4 w-4" />, onClick: () => setConfirmRemove(app), danger: true, disabled: busyNow },
            ];
            return (
              <div key={app.id} className="row-hover flex items-center gap-3 px-4 py-3">
                <AppIcon icon={`/app-icons/${app.manifestSlug}.svg`} name={app.name} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{app.name}</p>
                    <StatusBadge tone={APP_STATUS_TONE[app.status]}>{APP_STATUS_LABEL[app.status]}</StatusBadge>
                  </div>
                  <p className="truncate text-xs text-slate-400">
                    {app.manifestSlug} v{app.manifestVersion} · {app.containerNames.length} serviço{app.containerNames.length === 1 ? '' : 's'}
                    {app.lastError ? ` · ${app.lastError}` : ''}
                  </p>
                </div>
                <div className="hidden shrink-0 sm:block">
                  {primaryDomain ? (
                    <button onClick={() => setDomainsFor(app)} className="flex items-center gap-1.5 text-xs">
                      <StatusBadge tone={DOMAIN_TONE[primaryDomain.status]}>{primaryDomain.hostname}</StatusBadge>
                      {app.domains.length > 1 && <span className="text-slate-400">+{app.domains.length - 1}</span>}
                    </button>
                  ) : (
                    <button onClick={() => setDomainsFor(app)} className="btn-ghost px-2.5 py-1.5 text-xs">
                      Adicionar domínio
                    </button>
                  )}
                </div>
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
          title="Remover aplicação"
          message={`Remover "${confirmRemove.name}"? Os containers e volumes desta aplicação são apagados. Essa ação não pode ser desfeita.`}
          confirmLabel="Remover"
          danger
          loading={busy === confirmRemove.id}
          onConfirm={handleRemoveConfirmed}
          onCancel={() => setConfirmRemove(null)}
        />
      )}

      {domainsFor && (
        <DomainManagerModal
          app={domainsFor}
          onClose={() => setDomainsFor(null)}
          onChange={load}
        />
      )}

      {credentialsFor && <AppCredentialsModal app={credentialsFor} onClose={() => setCredentialsFor(null)} />}

      {servicesFor && (
        <ProjectServicesModal
          app={servicesFor}
          serverId={server.id}
          onClose={() => {
            setServicesFor(null);
            load();
          }}
        />
      )}
    </div>
  );
}

const SERVICE_STATUS_TONE: Record<ProjectService['status'], StatusTone> = {
  DEPLOYING: 'info',
  RUNNING: 'success',
  STOPPED: 'neutral',
  ERROR: 'danger',
};
const SERVICE_STATUS_LABEL: Record<ProjectService['status'], string> = {
  DEPLOYING: 'Implantando',
  RUNNING: 'Ativo',
  STOPPED: 'Parado',
  ERROR: 'Erro',
};

/** Painel do projeto — cada serviço (container) do projeto com ciclo de vida
 * próprio, e o fluxo real de "Adicionar serviço" pra componentes opcionais do
 * template (ex.: OnlyOffice num Nextcloud já implantado). */
function ProjectServicesModal({ app, serverId, onClose }: { app: ApplicationRow; serverId: string; onClose: () => void }) {
  const [services, setServices] = useState<ProjectService[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [picker, setPicker] = useState<CatalogApplicationDetail['services'] | null>(null);
  const [addingService, setAddingService] = useState<string | null>(null);
  const [addStatus, setAddStatus] = useState<OpsLogStatus>('connecting');

  function load() {
    apiFetch<ProjectService[]>(`/applications/${app.id}/services`)
      .then(setServices)
      .catch((e) => setError(e.message));
  }
  useEffect(load, [app.id]);

  async function handleAction(name: string, action: 'start' | 'stop' | 'restart') {
    setBusy(name);
    setError(null);
    try {
      await apiFetch(`/applications/${app.id}/services/${name}/${action}`, { method: 'POST' });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao executar ação');
    } finally {
      setBusy(null);
    }
  }

  async function openPicker() {
    setError(null);
    try {
      const detail = await apiFetch<CatalogApplicationDetail>(`/catalog/applications/${app.manifestSlug}`);
      const alreadyAdded = new Set((services ?? []).map((s) => s.name));
      setPicker(detail.services.filter((s) => s.optional && !alreadyAdded.has(s.name)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar componentes disponíveis');
    }
  }

  if (addingService) {
    const canClose = addStatus === 'done-ok' || addStatus === 'done-error';
    return (
      <Modal title={`Adicionando ${addingService}`} onClose={canClose ? () => { setAddingService(null); setPicker(null); load(); } : undefined} closeDisabled={!canClose}>
        <div className="h-[45vh]">
          <TerminalWindow
            title="Adicionar serviço"
            statusSlot={<StatusBadge tone={addStatus === 'done-ok' ? 'success' : addStatus === 'done-error' ? 'danger' : 'warning'}>{addStatus}</StatusBadge>}
            bodyClassName="flex h-full p-3"
          >
            <OpsLogPanel
              serverId={serverId}
              op="service-add"
              params={{ applicationId: app.id, serviceName: addingService }}
              onStatusChange={setAddStatus}
              onDone={() => undefined}
            />
          </TerminalWindow>
        </div>
      </Modal>
    );
  }

  if (picker) {
    return (
      <Modal title="Adicionar serviço" onClose={() => setPicker(null)}>
        {picker.length === 0 ? (
          <p className="text-sm text-slate-400">Todos os componentes opcionais deste template já foram adicionados.</p>
        ) : (
          <div className="card divide-y divide-slate-100 overflow-hidden dark:divide-slate-700">
            {picker.map((s) => (
              <div key={s.name} className="flex items-center justify-between gap-3 p-3.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{s.name}</p>
                  <p className="truncate text-xs text-slate-400">{s.image}</p>
                </div>
                <button
                  onClick={() => {
                    setAddingService(s.name);
                    setAddStatus('connecting');
                  }}
                  className="btn-primary shrink-0 px-3 py-1.5 text-xs"
                >
                  Adicionar
                </button>
              </div>
            ))}
          </div>
        )}
      </Modal>
    );
  }

  return (
    <Modal title={`Serviços — ${app.name}`} onClose={onClose} maxWidth="max-w-xl">
      {error && (
        <div className="mb-3">
          <Alert variant="error">{error}</Alert>
        </div>
      )}

      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs text-slate-400">{services?.length ?? 0} serviço{(services?.length ?? 0) === 1 ? '' : 's'} neste projeto</p>
        <button onClick={openPicker} className="btn-primary flex items-center gap-1.5 px-3 py-1.5 text-xs">
          <IconPlus className="h-3.5 w-3.5" />
          Adicionar serviço
        </button>
      </div>

      {services === null ? (
        <div className="card divide-y divide-slate-100 overflow-hidden dark:divide-slate-700">
          <SkeletonRow />
          <SkeletonRow />
        </div>
      ) : (
        <div className="card divide-y divide-slate-100 overflow-hidden dark:divide-slate-700">
          {services.map((s) => {
            const busyNow = busy === s.name;
            const running = s.status === 'RUNNING';
            return (
              <div key={s.id} className="flex items-center gap-3 p-3.5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{s.name}</p>
                    <span className={`badge text-[10px] ${s.required ? 'bg-green-500/10 text-green-600 dark:text-green-400' : 'bg-slate-500/10 text-slate-500'}`}>
                      {s.required ? 'obrigatório' : 'opcional'}
                    </span>
                    <StatusBadge tone={SERVICE_STATUS_TONE[s.status]}>{SERVICE_STATUS_LABEL[s.status]}</StatusBadge>
                  </div>
                  <p className="truncate text-xs text-slate-400">{s.image}</p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  {running ? (
                    <>
                      <button onClick={() => handleAction(s.name, 'restart')} disabled={busyNow} className="btn-secondary px-2.5 py-1 text-xs">
                        Reiniciar
                      </button>
                      <button onClick={() => handleAction(s.name, 'stop')} disabled={busyNow} className="btn-secondary px-2.5 py-1 text-xs">
                        Parar
                      </button>
                    </>
                  ) : (
                    <button onClick={() => handleAction(s.name, 'start')} disabled={busyNow} className="btn-secondary px-2.5 py-1 text-xs">
                      Iniciar
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

const DNS_STATE_LABEL: Record<DnsCheckResult['state'], string> = {
  NOT_CONFIGURED: 'DNS não configurado',
  CORRECT: 'DNS correto',
  INCORRECT: 'DNS incorreto',
};
const DNS_STATE_TONE: Record<DnsCheckResult['state'], StatusTone> = {
  NOT_CONFIGURED: 'neutral',
  CORRECT: 'success',
  INCORRECT: 'danger',
};
const CERT_STATE_LABEL: Record<CertificateInfo['state'], string> = {
  ACTIVE: 'Certificado ativo',
  EXPIRING: 'Certificado expirando',
  NOT_FOUND: 'Certificado ainda não emitido',
  ERROR: 'Falha ao ler certificado',
};
const CERT_STATE_TONE: Record<CertificateInfo['state'], StatusTone> = {
  ACTIVE: 'success',
  EXPIRING: 'warning',
  NOT_FOUND: 'neutral',
  ERROR: 'danger',
};

/** Gerencia os domínios de uma aplicação: listar, testar DNS/SSL de verdade,
 * adicionar (com seletor de serviço + porta interna detectados de verdade),
 * editar e remover — sem nunca tocar no container da aplicação. */
function DomainManagerModal({ app, onClose, onChange }: { app: ApplicationRow; onClose: () => void; onChange: () => void }) {
  const [endpoints, setEndpoints] = useState<EndpointServiceInfo[] | null>(null);
  const [domains, setDomains] = useState<ApplicationDomain[]>(app.domains);
  const [form, setForm] = useState<'new' | ApplicationDomain | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<ApplicationDomain | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checks, setChecks] = useState<Record<string, { dns?: DnsCheckResult; cert?: CertificateInfo; loading?: boolean }>>({});

  useEffect(() => {
    apiFetch<EndpointServiceInfo[]>(`/applications/${app.id}/endpoints`)
      .then(setEndpoints)
      .catch((e) => setError(e.message));
  }, [app.id]);

  function reload() {
    apiFetch<ApplicationRow>(`/applications/${app.id}`).then((a) => setDomains(a.domains));
    onChange();
  }

  async function handleTest(domain: ApplicationDomain) {
    setChecks((c) => ({ ...c, [domain.id]: { ...c[domain.id], loading: true } }));
    try {
      const [dns, cert] = await Promise.all([
        apiFetch<DnsCheckResult>(`/domains/${domain.id}/dns`),
        apiFetch<CertificateInfo>(`/domains/${domain.id}/certificate`),
      ]);
      setChecks((c) => ({ ...c, [domain.id]: { dns, cert, loading: false } }));
    } catch {
      setChecks((c) => ({ ...c, [domain.id]: { loading: false } }));
    }
  }

  async function handleRemoveConfirmed() {
    if (!confirmRemove) return;
    setBusy(confirmRemove.id);
    try {
      await apiFetch(`/domains/${confirmRemove.id}`, { method: 'DELETE' });
      setConfirmRemove(null);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao remover domínio');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal title={`Domínios — ${app.name}`} onClose={onClose} maxWidth="max-w-xl">
      {error && (
        <div className="mb-3">
          <Alert variant="error">{error}</Alert>
        </div>
      )}

      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs text-slate-400">{domains.length} domínio{domains.length === 1 ? '' : 's'} associado{domains.length === 1 ? '' : 's'}</p>
        <button onClick={() => setForm('new')} disabled={!endpoints} className="btn-primary flex items-center gap-1.5 px-3 py-1.5 text-xs">
          <IconPlus className="h-3.5 w-3.5" />
          Adicionar domínio
        </button>
      </div>

      {domains.length === 0 ? (
        <EmptyState icon={<IconGlobe className="h-5 w-5" />} title="Nenhum domínio associado" />
      ) : (
        <div className="card divide-y divide-slate-100 overflow-hidden dark:divide-slate-700">
          {domains.map((d) => {
            const check = checks[d.id];
            return (
              <div key={d.id} className="p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{d.hostname}</p>
                  <StatusBadge tone={DOMAIN_TONE[d.status]}>{DOMAIN_LABEL[d.status]}</StatusBadge>
                </div>
                <p className="mt-0.5 truncate text-xs text-slate-400">
                  → {d.serviceName ?? '—'}:{d.targetPort}
                  {d.lastError ? ` · ${d.lastError}` : ''}
                </p>

                {check?.dns && check?.cert && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <StatusBadge tone={DNS_STATE_TONE[check.dns.state]}>{DNS_STATE_LABEL[check.dns.state]}</StatusBadge>
                    <StatusBadge tone={CERT_STATE_TONE[check.cert.state]}>
                      {CERT_STATE_LABEL[check.cert.state]}
                      {check.cert.daysRemaining != null ? ` (${check.cert.daysRemaining}d)` : ''}
                    </StatusBadge>
                  </div>
                )}

                <div className="mt-2 flex flex-wrap gap-2">
                  <button onClick={() => handleTest(d)} disabled={check?.loading} className="btn-secondary px-2.5 py-1 text-xs">
                    {check?.loading ? 'Testando...' : 'Testar DNS e SSL'}
                  </button>
                  <button onClick={() => setForm(d)} className="btn-secondary px-2.5 py-1 text-xs">
                    Editar
                  </button>
                  <a href={`https://${d.hostname}`} target="_blank" rel="noreferrer" className="btn-ghost px-2.5 py-1 text-xs">
                    Abrir
                  </a>
                  <button
                    onClick={() => setConfirmRemove(d)}
                    disabled={busy === d.id}
                    className="rounded-lg px-2.5 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
                  >
                    Remover
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {form && endpoints && (
        <DomainForm
          app={app}
          endpoints={endpoints}
          editing={form === 'new' ? null : form}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            reload();
          }}
        />
      )}

      {confirmRemove && (
        <ConfirmModal
          title="Remover domínio"
          message={`Remover "${confirmRemove.hostname}"? A rota é apagada do Traefik. A aplicação continua rodando normalmente.`}
          confirmLabel="Remover"
          danger
          loading={busy === confirmRemove.id}
          onConfirm={handleRemoveConfirmed}
          onCancel={() => setConfirmRemove(null)}
        />
      )}
    </Modal>
  );
}

function DomainForm({
  app,
  endpoints,
  editing,
  onClose,
  onSaved,
}: {
  app: ApplicationRow;
  endpoints: EndpointServiceInfo[];
  editing: ApplicationDomain | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [serviceName, setServiceName] = useState(editing?.serviceName ?? endpoints[0]?.serviceName ?? '');
  const selectedService = endpoints.find((e) => e.serviceName === serviceName);
  const [port, setPort] = useState<number>(editing?.targetPort ?? selectedService?.ports[0]?.port ?? 0);
  const [hostname, setHostname] = useState(editing?.hostname ?? '');
  const [createDnsRecord, setCreateDnsRecord] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleServiceChange(name: string) {
    setServiceName(name);
    const svc = endpoints.find((e) => e.serviceName === name);
    setPort(svc?.ports[0]?.port ?? 0);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (editing) {
        await apiFetch(`/applications/${app.id}/domains/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ hostname: editing.hostname, serviceName, port, createDnsRecord }),
        });
      } else {
        await apiFetch(`/applications/${app.id}/domains`, {
          method: 'POST',
          body: JSON.stringify({ hostname, serviceName, port, createDnsRecord }),
        });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar domínio');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={editing ? 'Editar domínio' : 'Adicionar domínio'} onClose={onClose} closeDisabled={saving}>
      <form onSubmit={handleSubmit}>
        {editing ? (
          <p className="mb-3 text-sm text-slate-500">
            Domínio: <span className="font-medium text-slate-700 dark:text-slate-200">{editing.hostname}</span>
          </p>
        ) : (
          <label className="mb-3 block text-sm">
            <span className="mb-1 block font-medium">Domínio</span>
            <input required placeholder="app.seudominio.com" value={hostname} onChange={(e) => setHostname(e.target.value)} className="input" />
          </label>
        )}

        <label className="mb-3 block text-sm">
          <span className="mb-1 block font-medium">Serviço</span>
          <select value={serviceName} onChange={(e) => handleServiceChange(e.target.value)} className="input">
            {endpoints.map((svc) => (
              <option key={svc.serviceName} value={svc.serviceName}>
                {svc.serviceName} — {svc.image}
                {!svc.running ? ' (parado)' : ''}
              </option>
            ))}
          </select>
        </label>

        <label className="mb-3 block text-sm">
          <span className="mb-1 block font-medium">Porta interna</span>
          {selectedService && selectedService.ports.length > 0 ? (
            <select value={port} onChange={(e) => setPort(Number(e.target.value))} className="input">
              {selectedService.ports.map((p) => (
                <option key={p.port} value={p.port}>
                  {p.port}/{p.protocol}
                  {p.recommended ? ' — recomendada' : ''}
                </option>
              ))}
            </select>
          ) : (
            <input
              required
              type="number"
              min={1}
              max={65535}
              placeholder="Nenhuma porta detectada — informe manualmente"
              value={port || ''}
              onChange={(e) => setPort(Number(e.target.value))}
              className="input"
            />
          )}
        </label>

        {!editing && (
          <label className="mb-3 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={createDnsRecord} onChange={(e) => setCreateDnsRecord(e.target.checked)} />
            Criar registro DNS na Cloudflare automaticamente
          </label>
        )}

        {error && (
          <div className="mb-3">
            <Alert variant="error">{error}</Alert>
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800">
            Cancelar
          </button>
          <button type="submit" disabled={saving || !port} className="btn-primary px-4 py-2 text-sm">
            {saving ? 'Salvando...' : editing ? 'Salvar alterações' : 'Adicionar domínio'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function AppCredentialsModal({ app, onClose }: { app: ApplicationRow; onClose: () => void }) {
  const [credentials, setCredentials] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Record<string, string>>(`/applications/${app.id}/credentials`)
      .then(setCredentials)
      .catch((e) => setError(e.message));
  }, [app.id]);

  function copy(key: string, value: string) {
    navigator.clipboard.writeText(value);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  }

  const entries = credentials ? Object.entries(credentials) : [];

  return (
    <Modal title={`Credenciais — ${app.name}`} onClose={onClose}>
      {error && <Alert variant="error">{error}</Alert>}
      {!credentials && !error && <p className="text-sm text-slate-400">Carregando...</p>}
      {credentials && entries.length === 0 && <p className="text-sm text-slate-400">Esta aplicação não gerou segredos.</p>}
      {entries.length > 0 && (
        <div>
          <div className="mb-3 flex justify-end">
            <button onClick={() => setRevealed((v) => !v)} className="text-xs text-indigo-600 hover:underline dark:text-indigo-400">
              {revealed ? 'Ocultar valores' : 'Mostrar valores'}
            </button>
          </div>
          <div className="space-y-2">
            {entries.map(([key, value]) => (
              <div key={key} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
                <div className="min-w-0">
                  <p className="text-xs text-slate-500">{key}</p>
                  <p className="truncate font-mono text-sm">{revealed ? value : '••••••••••••'}</p>
                </div>
                <button onClick={() => copy(key, value)} className="shrink-0 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                  {copiedKey === key ? 'Copiado!' : 'Copiar'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
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
              <button onClick={loadStatus} className="btn-secondary flex items-center gap-1.5 px-3 py-1.5 text-xs">
                <IconRefresh className="h-3.5 w-3.5" />
                Atualizar
              </button>
            </>
          }
          menu={[{ label: 'Desinstalar Traefik', icon: <IconTrash className="h-4 w-4" />, onClick: () => setConfirmUninstall(true), danger: true }]}
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
              <div key={d.id} className="row-hover flex items-center gap-3 px-4 py-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                  <IconGlobe className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{d.hostname}</p>
                    <StatusBadge tone={DOMAIN_TONE[d.status]}>{DOMAIN_LABEL[d.status]}</StatusBadge>
                  </div>
                  <p className="truncate text-xs text-slate-400">
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
  const [status, setStatus] = useState<'connecting' | 'connected' | 'closed' | 'error'>('connecting');

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
        theme: TERMINAL_THEME,
      });
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

interface MirrorInfo {
  targetServerId: string;
  targetServerName: string;
}

function MirrorSection({ serverId }: { serverId: string }) {
  const [servers, setServers] = useState<{ id: string; name: string }[]>([]);
  const [mirror, setMirror] = useState<MirrorInfo | null>(null);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    apiFetch<{ id: string; name: string }[]>('/servers').then((all) => setServers(all.filter((s) => s.id !== serverId)));
    apiFetch<MirrorInfo | null>(`/servers/${serverId}/mirror`).then(setMirror);
  }

  useEffect(load, [serverId]);

  async function handleActivate() {
    if (!selected) return;
    setLoading(true);
    setError(null);
    try {
      await apiFetch(`/servers/${serverId}/mirror`, { method: 'POST', body: JSON.stringify({ targetServerId: selected }) });
      // ponytail: ativar o espelho só cobre bancos futuros — sem isso, o que já
      // existia no servidor ficava de fora e precisava ser replicado um por um
      // à parte.
      const existing = await apiFetch<DatabaseInstanceSummary[]>(`/servers/${serverId}/databases`);
      const primaryIds = existing.filter((i) => i.role === 'STANDALONE' || i.role === 'PRIMARY').map((i) => i.id);
      if (primaryIds.length > 0) {
        await apiFetch('/databases/replicate-bulk', {
          method: 'POST',
          body: JSON.stringify({ primaryInstanceIds: primaryIds, targetServerId: selected }),
        });
      }
      setSelected('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao ativar espelhamento');
    } finally {
      setLoading(false);
    }
  }

  async function handleDeactivate() {
    setLoading(true);
    try {
      await apiFetch(`/servers/${serverId}/mirror`, { method: 'DELETE' });
      load();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card mb-4 p-4">
      <h2 className="section-title mb-1">Espelhamento automático</h2>
      <p className="mb-3 text-sm text-slate-500">
        Ao ativar, os bancos que já existem aqui são replicados agora, e todo banco novo instalado neste servidor também já sobe replicado
        automaticamente — sem precisar clicar em nada.
      </p>

      {mirror ? (
        <div className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm dark:border-green-900 dark:bg-green-900/20">
          <span className="text-green-800 dark:text-green-300">
            Espelhando bancos novos para <strong>{mirror.targetServerName}</strong>
          </span>
          <button onClick={handleDeactivate} disabled={loading} className="text-red-600 hover:underline disabled:opacity-50 dark:text-red-400">
            {loading ? 'Desativando...' : 'Desativar'}
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <select value={selected} onChange={(e) => setSelected(e.target.value)} className="input max-w-xs">
            <option value="">Selecione o servidor espelho...</option>
            {servers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button onClick={handleActivate} disabled={loading || !selected} className="btn-secondary px-3 py-2 text-sm">
            {loading ? 'Ativando...' : 'Ativar espelhamento'}
          </button>
        </div>
      )}

      {error && (
        <div className="mt-2">
          <Alert variant="error">{error}</Alert>
        </div>
      )}
    </div>
  );
}

function DatabasesTab({ server }: { server: Server }) {
  const [instances, setInstances] = useState<DatabaseInstanceSummary[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [showAddReplica, setShowAddReplica] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [instanceLoading, setInstanceLoading] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<DatabaseInstanceSummary | null>(null);

  function load() {
    apiFetch<DatabaseInstanceSummary[]>(`/servers/${server.id}/databases`)
      .then(setInstances)
      .catch((e) => setError(e.message));
  }

  useEffect(load, [server.id]);

  async function handleToggle(inst: DatabaseInstanceSummary) {
    const running = inst.status === 'ONLINE';
    setInstanceLoading(inst.id);
    setError(null);
    try {
      await apiFetch(`/databases/${inst.id}/${running ? 'stop' : 'start'}`, { method: 'POST' });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Falha ao ${running ? 'parar' : 'iniciar'} instância`);
    } finally {
      setInstanceLoading(null);
    }
  }

  async function handleRemoveConfirmed() {
    if (!confirmRemove) return;
    setInstanceLoading(confirmRemove.id);
    try {
      await apiFetch(`/databases/${confirmRemove.id}`, { method: 'DELETE' });
      setConfirmRemove(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao excluir instância');
    } finally {
      setInstanceLoading(null);
    }
  }

  if (!server.dockerInstalled) {
    return <p className="text-sm text-slate-500">Instale o Docker (aba Docker) antes de criar um banco de dados.</p>;
  }

  return (
    <div>
      <MirrorSection serverId={server.id} />

      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-medium">Instâncias MySQL</h2>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowAddReplica(true)} className="btn-secondary flex items-center gap-2 px-4 py-2 text-sm">
            <IconPlus className="h-4 w-4" />
            Adicionar réplica existente
          </button>
          <button
            onClick={() => setShowForm(true)}
            className="btn-primary flex items-center gap-2 px-4 py-2 text-sm"
          >
            <IconDownload className="h-4 w-4" />
            Instalar MySQL
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-3">
          <Alert variant="error">{error}</Alert>
        </div>
      )}

      {instances.length === 0 ? (
        <div className="card p-8 text-center text-sm text-slate-400">Nenhum banco instalado neste servidor.</div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {instances.map((inst) => {
            const running = inst.status === 'ONLINE';
            const busy = instanceLoading === inst.id;
            return (
              <Link key={inst.id} href={`/databases/${inst.id}`} className="card card-hover p-5">
                <div className="mb-4 flex items-start gap-3">
                  <span className={`icon-chip shrink-0 text-base font-semibold ${avatarColor(inst.name)}`}>
                    {inst.name.slice(0, 2).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{inst.name}</p>
                    <p className="truncate text-xs text-slate-400">
                      {inst.engine} · porta {inst.port}
                    </p>
                  </div>
                  <span
                    className={`badge shrink-0 ${running ? 'bg-green-500/10 text-green-600 dark:text-green-400' : 'bg-slate-500/10 text-slate-500'}`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${running ? 'bg-green-500' : 'bg-slate-400'}`} />
                    {running ? 'Ativo' : 'Parado'}
                  </span>
                </div>
                <p className="mb-4 truncate rounded-lg bg-slate-100 px-2.5 py-1.5 font-mono text-xs text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                  {inst.role}
                </p>
                <div className="flex items-center justify-end gap-1 border-t border-slate-100 pt-3 dark:border-slate-700">
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      handleToggle(inst);
                    }}
                    disabled={busy}
                    title={running ? 'Parar' : 'Iniciar'}
                    className={`rounded-lg p-1.5 disabled:opacity-40 ${running ? 'text-green-600 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-900/20' : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                  >
                    <IconPower className="h-4 w-4" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      setConfirmRemove(inst);
                    }}
                    disabled={busy}
                    title="Excluir"
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                  >
                    <IconTrash className="h-4 w-4" />
                  </button>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {showForm && (
        <InstallMysqlModal
          serverId={server.id}
          onClose={() => setShowForm(false)}
          onCreated={() => {
            setShowForm(false);
            load();
          }}
        />
      )}

      {showAddReplica && (
        <AddExistingReplicaModal
          targetServerId={server.id}
          onClose={() => setShowAddReplica(false)}
          onCreated={() => {
            setShowAddReplica(false);
            load();
          }}
        />
      )}

      {confirmRemove && (
        <ConfirmModal
          title="Excluir instância MySQL"
          message={`Tem certeza que quer excluir "${confirmRemove.name}"? O container e seus dados são removidos permanentemente.`}
          confirmLabel="Excluir"
          danger
          loading={instanceLoading === confirmRemove.id}
          onConfirm={handleRemoveConfirmed}
          onCancel={() => setConfirmRemove(null)}
        />
      )}
    </div>
  );
}

interface EligiblePrimary {
  id: string;
  name: string;
  serverName: string;
  databaseName: string;
}

function AddExistingReplicaModal({
  targetServerId,
  onClose,
  onCreated,
}: {
  targetServerId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [primaries, setPrimaries] = useState<EligiblePrimary[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState<number | null>(null);

  useEffect(() => {
    apiFetch<EligiblePrimary[]>(`/databases/eligible-primaries?excludeServerId=${targetServerId}`).then(setPrimaries);
  }, [targetServerId]);

  const allSelected = primaries.length > 0 && selectedIds.size === primaries.length;

  function toggleAll() {
    setSelectedIds(allSelected ? new Set() : new Set(primaries.map((p) => p.id)));
  }

  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (selectedIds.size === 0) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch<{ ok: boolean; queued: number }>('/databases/replicate-bulk', {
        method: 'POST',
        body: JSON.stringify({ primaryInstanceIds: Array.from(selectedIds), targetServerId }),
      });
      setQueued(res.queued);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao enviar réplicas');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={queued != null ? 'Réplicas na fila' : 'Adicionar réplica existente'} onClose={queued != null ? onCreated : onClose} closeDisabled={saving}>
      {queued != null ? (
        <div>
          <Alert variant="info">
            {queued} réplica{queued === 1 ? '' : 's'} sendo criada{queued === 1 ? '' : 's'} em segundo plano — cada uma leva alguns minutos
            (dump + cópia). Atualize a lista daqui a pouco pra ver o status.
          </Alert>
          <button onClick={onCreated} className="mt-4 w-full btn-primary px-4 py-2 text-sm">
            Fechar
          </button>
        </div>
      ) : primaries.length === 0 ? (
        <div>
          <Alert variant="info">
            Nenhum banco primário/standalone disponível em outro servidor pra replicar aqui — instale um em outro servidor primeiro.
          </Alert>
          <button type="button" onClick={onClose} className="mt-4 w-full btn-secondary px-4 py-2 text-sm">
            Fechar
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <label className="mb-2 flex items-center gap-2 border-b border-slate-200 pb-2 text-sm font-medium dark:border-slate-700">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} />
            Selecionar todos
          </label>
          <div className="mb-3 max-h-56 space-y-1 overflow-y-auto">
            {primaries.map((p) => (
              <label
                key={p.id}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <input type="checkbox" checked={selectedIds.has(p.id)} onChange={() => toggleOne(p.id)} />
                <span className="font-medium">{p.name}</span>
                <span className="text-xs text-slate-400">({p.serverName})</span>
              </label>
            ))}
          </div>
          {error && <p className="mb-3 text-sm text-red-500">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
              Cancelar
            </button>
            <button type="submit" disabled={saving || selectedIds.size === 0} className="btn-primary px-4 py-2 text-sm">
              {saving ? 'Enviando...' : `Replicar selecionados (${selectedIds.size})`}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function InstallMysqlModal({ serverId, onClose, onCreated }: { serverId: string; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ name: '', port: 3306, databaseName: 'app', appUser: 'app' });
  const [showLog, setShowLog] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ rootPassword: string; appPassword: string; warnings: string[] } | null>(null);

  function handleDone(ok: boolean, result: unknown) {
    if (ok) {
      setCreated(result as { rootPassword: string; appPassword: string; warnings: string[] });
    } else {
      setError(typeof result === 'string' ? result : 'Falha ao instalar MySQL — veja o log acima.');
    }
  }

  if (showLog && !created) {
    return (
      <InstallLogModal
        serverId={serverId}
        op="mysql-install"
        params={form}
        title="Instalando MySQL"
        onClose={() => (error ? setShowLog(false) : onClose())}
        onDone={handleDone}
      />
    );
  }

  return (
    <Modal title={created ? 'MySQL instalado' : 'Instalar MySQL'} onClose={created ? onCreated : onClose}>
      {error && (
        <div className="mb-3">
          <Alert variant="error">{error}</Alert>
        </div>
      )}
      {created ? (
        <div>
          <p className="mb-1 text-sm">
            Senha root: <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">{created.rootPassword}</code>
          </p>
          <p className="mb-3 text-sm">
            Senha do app: <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">{created.appPassword}</code>
          </p>
          {created.warnings.length > 0 && (
            <div className="mb-2 space-y-2">
              {created.warnings.map((w) => (
                <Alert key={w} variant="warning">
                  {w}
                </Alert>
              ))}
            </div>
          )}
          <button
            onClick={onCreated}
            className="mt-2 w-full btn-primary px-4 py-2 text-sm"
          >
            Fechar
          </button>
        </div>
      ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              setShowLog(true);
            }}
          >
            <div className="grid grid-cols-3 gap-3">
              <label className="col-span-2 mb-3 block text-sm">
                <span className="mb-1 block font-medium">Nome da instância</span>
                <input
                  required
                  placeholder="ex: principal"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="input"
                />
              </label>
              <label className="mb-3 block text-sm">
                <span className="mb-1 block font-medium">Porta</span>
                <input
                  required
                  type="number"
                  value={form.port}
                  onChange={(e) => setForm({ ...form, port: Number(e.target.value) })}
                  className="input"
                />
              </label>
            </div>
            <label className="mb-3 block text-sm">
              <span className="mb-1 block font-medium">Banco inicial</span>
              <input required value={form.databaseName} onChange={(e) => setForm({ ...form, databaseName: e.target.value })} className="input" />
            </label>
            <label className="mb-3 block text-sm">
              <span className="mb-1 block font-medium">Usuário inicial</span>
              <input required value={form.appUser} onChange={(e) => setForm({ ...form, appUser: e.target.value })} className="input" />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
                Cancelar
              </button>
              <button type="submit" className="btn-primary px-4 py-2 text-sm">
                Instalar
              </button>
            </div>
          </form>
        )}
    </Modal>
  );
}
