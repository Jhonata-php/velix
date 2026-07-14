'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiFetch, getToken } from '@/lib/api';
import { useAutoRefresh } from '@/lib/useAutoRefresh';
import { TERMINAL_THEME } from '@/lib/terminalTheme';
import { Bar } from '@/components/Bar';
import { Alert } from '@/components/Alert';
import { InstallLogModal } from '@/components/InstallLogModal';
import { Modal, ConfirmModal } from '@/components/Modal';
import { ServerFormModal } from '@/components/ServerFormModal';
import { Sparkline } from '@/components/Sparkline';
import { MetricHistoryModal } from '@/components/MetricHistoryModal';
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
  IconRefresh,
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
  easypanelInstalled: boolean;
  easypanelUrl: string | null;
  metrics: ServerMetrics | null;
  metricsCheckedAt: string | null;
  lastCheckedAt: string | null;
}

const TABS = [
  { key: 'overview', label: 'Visão geral' },
  { key: 'updates', label: 'Atualizações' },
  { key: 'docker', label: 'Docker' },
  { key: 'easypanel', label: 'EasyPanel' },
  { key: 'databases', label: 'Bancos' },
  { key: 'terminal', label: 'Terminal' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

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

  if (!server) return null;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{server.name}</h1>
          <p className="text-sm text-slate-500">
            {server.sshUser}@{server.publicIp ?? server.privateIp ?? server.hostname}:{server.sshPort}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setEditing(true)} className="btn-secondary flex items-center gap-2 px-3 py-2 text-sm">
            <IconPencil className="h-4 w-4" />
            Editar
          </button>
          <button onClick={() => setDeleting(true)} className="btn-danger flex items-center gap-2 px-3 py-2 text-sm">
            <IconTrash className="h-4 w-4" />
            Excluir
          </button>
          <StatusPill status={server.status} />
        </div>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        <Badge ok={server.dockerInstalled} label={server.dockerInstalled ? `Docker ${server.dockerVersion ?? ''}` : 'Docker não instalado'} />
        <Badge
          ok={server.easypanelInstalled}
          label={server.easypanelInstalled ? 'EasyPanel instalado' : 'EasyPanel não instalado'}
        />
      </div>

      <div className="mb-6 flex gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1 dark:bg-slate-800/60">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`tab-pill ${tab === t.key ? 'tab-pill-active' : ''}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab server={server} onChange={load} />}
      {tab === 'updates' && <UpdatesTab serverId={server.id} />}
      {tab === 'docker' && <DockerTab server={server} onChange={load} />}
      {tab === 'easypanel' && <EasyPanelTab server={server} onChange={load} />}
      {tab === 'databases' && <DatabasesTab server={server} />}
      {tab === 'terminal' && <TerminalTab serverId={server.id} />}

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

function StatCard({
  icon,
  label,
  chip,
  onClick,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  chip: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className={`card card-hover p-4 ${onClick ? 'cursor-pointer' : ''}`} onClick={onClick}>
      <div className="mb-3 flex items-center gap-2.5">
        <span className={`icon-chip h-8 w-8 ${chip}`}>{icon}</span>
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      </div>
      {children}
    </div>
  );
}

const STATUS_PILL_STYLE: Record<string, string> = {
  ONLINE: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400',
  PENDING: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
  OFFLINE: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  ERROR: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
};

function StatusPill({ status }: { status: string }) {
  return (
    <span className={`badge ${STATUS_PILL_STYLE[status] ?? STATUS_PILL_STYLE.OFFLINE}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {status}
    </span>
  );
}

function Badge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`badge border ${
        ok
          ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-900/20 dark:text-green-400'
          : 'border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-green-500' : 'bg-slate-400'}`} />
      {label}
    </span>
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

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard icon={<IconServer className="h-4 w-4" />} chip="bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400" label="Sistema operacional">
          <p className="truncate text-sm font-semibold">{server.osName ? `${server.osName} ${server.osVersion ?? ''}` : '—'}</p>
        </StatCard>

        <StatCard icon={<IconClock className="h-4 w-4" />} chip="bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-400" label="Uptime">
          <p className="text-sm font-semibold">{server.metrics?.uptimeText ?? '—'}</p>
        </StatCard>

        <StatCard
          icon={<IconActivity className="h-4 w-4" />}
          chip="bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-400"
          label="Load average"
          onClick={() => setExpandedMetric('load')}
        >
          {server.metrics?.loadAvg ? (
            <>
              <p className="text-sm font-semibold">{server.metrics.loadAvg.join(' · ')}</p>
              <Sparkline data={loadHistory} className="mt-2 h-12 w-full text-violet-500 dark:text-violet-400" />
            </>
          ) : (
            <p className="text-sm font-semibold">—</p>
          )}
        </StatCard>

        <StatCard
          icon={<IconMemory className="h-4 w-4" />}
          chip="bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400"
          label="Memória"
          onClick={() => setExpandedMetric('mem')}
        >
          {memPercent !== null ? (
            <>
              <div className="flex items-center gap-2">
                <Bar percent={memPercent} />
                <span className="shrink-0 text-xs text-slate-500">
                  {server.metrics?.memUsedMb}/{server.metrics?.memTotalMb}MB
                </span>
              </div>
              <Sparkline data={memHistory} className="mt-2 h-12 w-full text-amber-500 dark:text-amber-400" />
            </>
          ) : (
            <p className="text-sm font-semibold">—</p>
          )}
        </StatCard>

        <StatCard
          icon={<IconDisk className="h-4 w-4" />}
          chip="bg-teal-50 text-teal-600 dark:bg-teal-500/10 dark:text-teal-400"
          label="Disco"
          onClick={() => setExpandedMetric('disk')}
        >
          {diskPercent !== null ? (
            <>
              <div className="flex items-center gap-2">
                <Bar percent={diskPercent} />
                <span className="shrink-0 text-xs text-slate-500">
                  {server.metrics?.diskUsed}/{server.metrics?.diskTotal}
                </span>
              </div>
              <Sparkline data={diskHistory} className="mt-2 h-12 w-full text-teal-500 dark:text-teal-400" />
            </>
          ) : (
            <p className="text-sm font-semibold">—</p>
          )}
        </StatCard>
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

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
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
                <li key={d.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-800">
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
            <thead className="border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Pacote</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Versão</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Segurança</th>
              </tr>
            </thead>
            <tbody>
              {info.packages.map((p) => (
                <tr key={p.name} className="border-t border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40">
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

interface DockerContainer {
  id: string;
  image: string;
  status: string;
  names: string;
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

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-slate-500">Versão do Docker: {status?.version ?? server.dockerVersion}</p>
        <div className="flex items-center gap-2">
          <button onClick={loadStatus} className="btn-secondary px-3 py-1.5 text-xs">
            ↻ Atualizar
          </button>
          <button onClick={() => setConfirmUninstall(true)} className="btn-danger px-3 py-1.5 text-xs">
            Desinstalar Docker
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-3">
          <Alert variant="error">{error}</Alert>
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 dark:border-slate-800">
            <tr>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Container</th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Imagem</th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Ações</th>
            </tr>
          </thead>
          <tbody>
            {status?.containers?.map((c) => {
              const running = c.status.toLowerCase().includes('up');
              const busy = containerLoading === c.id;
              const instance = instances.find((i) => i.containerName === c.names);
              const canReplicate = instance && instance.role !== 'REPLICA';
              return (
                <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40">
                  <td className="px-4 py-3">{c.names}</td>
                  <td className="px-4 py-3 text-slate-500">{c.image}</td>
                  <td className="px-4 py-3">{c.status}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      {canReplicate && (
                        <button
                          onClick={() => setReplicateTarget(instance)}
                          title="Configurar replicação"
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-indigo-50 hover:text-indigo-600 dark:hover:bg-indigo-900/20 dark:hover:text-indigo-400"
                        >
                          <IconRefresh className="h-4 w-4" />
                        </button>
                      )}
                      <button
                        onClick={() => handleToggle(c)}
                        disabled={busy}
                        title={running ? 'Parar' : 'Iniciar'}
                        className={`rounded-lg p-1.5 disabled:opacity-40 ${running ? 'text-green-600 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-900/20' : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                      >
                        <IconPower className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setConfirmRemove(c)}
                        disabled={busy}
                        title="Remover"
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                      >
                        <IconTrash className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {(!status?.containers || status.containers.length === 0) && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                  Nenhum container em execução.
                </td>
              </tr>
            )}
          </tbody>
        </table>
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

      {confirmUninstall && (
        <ConfirmModal
          title="Desinstalar Docker"
          message="Isso remove o Docker Engine e todos os containers deste servidor — incluindo EasyPanel e bancos MySQL geridos por ele. Essa ação não pode ser desfeita."
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
    </div>
  );
}

interface EasyPanelStatusResp {
  installed: boolean;
  url?: string | null;
  containers?: DockerContainer[];
}

function EasyPanelTab({ server, onChange }: { server: Server; onChange: () => void }) {
  const [domain, setDomain] = useState('');
  const [createDnsRecord, setCreateDnsRecord] = useState(true);
  const [showLog, setShowLog] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<EasyPanelStatusResp | null>(null);
  const [checked, setChecked] = useState(false);
  const [containerLoading, setContainerLoading] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<DockerContainer | null>(null);
  const [confirmUninstall, setConfirmUninstall] = useState(false);
  const [showUninstallLog, setShowUninstallLog] = useState(false);

  function loadStatus() {
    apiFetch<EasyPanelStatusResp>(`/servers/${server.id}/easypanel/status`)
      .then((res) => {
        setStatus(res);
        setChecked(true);
        // a checagem é sempre real (não confia na flag salva) — se ela
        // discordar do que a página já tinha carregado, atualiza o resto da UI
        if (res.installed !== server.easypanelInstalled) onChange();
      })
      .catch((e) => {
        setError(e.message);
        setChecked(true);
      });
  }

  // Roda sempre, mesmo que a flag salva diga "não instalado" — é justamente
  // esse caso que precisa da reconferência (ver bug corrigido no backend).
  useEffect(() => {
    if (server.dockerInstalled) loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server.id]);
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
    return <p className="text-sm text-slate-500">Instale o Docker (aba Docker) antes de instalar o EasyPanel.</p>;
  }

  if (!checked) return null;

  if (!status?.installed) {
    return (
      <div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setShowLog(true);
          }}
          className="max-w-sm space-y-3"
        >
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Domínio (opcional)</span>
            <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="painel.seudominio.com" className="input" />
            <span className="mt-1 block text-xs text-slate-400">
              Cria o registro DNS apontando pro servidor. Configurar esse domínio dentro do EasyPanel é manual (feito na UI dele).
            </span>
          </label>
          {domain && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={createDnsRecord} onChange={(e) => setCreateDnsRecord(e.target.checked)} />
              Criar registro DNS na Cloudflare automaticamente
            </label>
          )}
          <button type="submit" className="btn-primary flex items-center gap-2 px-4 py-2 text-sm">
            <IconDownload className="h-4 w-4" />
            Instalar EasyPanel
          </button>
        </form>

        {error && (
          <div className="mt-3">
            <Alert variant="error">{error}</Alert>
          </div>
        )}

        {showLog && (
          <InstallLogModal
            serverId={server.id}
            op="easypanel-install"
            params={{ domain: domain || undefined, createDnsRecord }}
            title="Instalando EasyPanel"
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

  return (
    <div>
      <Alert variant="info" title="Falta um passo manual">
        A conta de administrador do EasyPanel é criada na primeira vez que você abre o painel — não tem como o Velix criar isso
        automaticamente. Abra o link abaixo e defina seu e-mail/senha por lá.
      </Alert>

      <div className="my-4 flex items-center justify-between">
        <a href={status.url ?? '#'} target="_blank" rel="noreferrer" className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">
          Abrir EasyPanel ({status.url})
        </a>
        <div className="flex items-center gap-2">
          <button onClick={loadStatus} className="btn-secondary px-3 py-1.5 text-xs">
            ↻ Atualizar
          </button>
          <button onClick={() => setConfirmUninstall(true)} className="btn-danger px-3 py-1.5 text-xs">
            Desinstalar EasyPanel
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-3">
          <Alert variant="error">{error}</Alert>
        </div>
      )}

      <EasyPanelDomainLock serverId={server.id} defaultDomain={extractHostname(status.url ?? null)} />

      <div className="card mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 dark:border-slate-800">
            <tr>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Container</th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Imagem</th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Ações</th>
            </tr>
          </thead>
          <tbody>
            {status?.containers?.map((c) => {
              const running = c.status.toLowerCase().includes('up');
              const busy = containerLoading === c.id;
              return (
                <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40">
                  <td className="px-4 py-3">{c.names}</td>
                  <td className="px-4 py-3 text-slate-500">{c.image}</td>
                  <td className="px-4 py-3">{c.status}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => handleToggle(c)}
                        disabled={busy}
                        title={running ? 'Parar' : 'Iniciar'}
                        className={`rounded-lg p-1.5 disabled:opacity-40 ${running ? 'text-green-600 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-900/20' : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                      >
                        <IconPower className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setConfirmRemove(c)}
                        disabled={busy}
                        title="Remover"
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                      >
                        <IconTrash className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {(!status?.containers || status.containers.length === 0) && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                  Nenhum container encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
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

      {confirmUninstall && (
        <ConfirmModal
          title="Desinstalar EasyPanel"
          message="Isso remove o stack do EasyPanel e sai do Docker Swarm. Os containers e volumes criados por ele são perdidos. Essa ação não pode ser desfeita."
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
          op="easypanel-uninstall"
          title="Desinstalando EasyPanel"
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

function extractHostname(url: string | null): string {
  if (!url) return '';
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function EasyPanelDomainLock({ serverId, defaultDomain }: { serverId: string; defaultDomain: string }) {
  const [domain, setDomain] = useState(defaultDomain);
  const [checking, setChecking] = useState(false);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [locking, setLocking] = useState(false);
  const [lockMessage, setLockMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleVerify() {
    setChecking(true);
    setError(null);
    setReachable(null);
    try {
      const res = await apiFetch<{ reachable: boolean }>(`/servers/${serverId}/easypanel/verify-domain?domain=${encodeURIComponent(domain)}`);
      setReachable(res.reachable);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao verificar domínio');
    } finally {
      setChecking(false);
    }
  }

  async function handleLock() {
    setLocking(true);
    setError(null);
    try {
      const res = await apiFetch<{ ok: boolean; message: string }>(`/servers/${serverId}/easypanel/lock-port`, { method: 'POST' });
      setLockMessage(res.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao configurar firewall');
    } finally {
      setLocking(false);
    }
  }

  return (
    <div className="card p-4">
      <h2 className="section-title mb-1">Domínio personalizado</h2>
      <p className="mb-3 text-sm text-slate-500">
        Depois de configurar o domínio dentro do EasyPanel (com HTTPS), confirme aqui — e então dá pra fechar o acesso direto pela
        porta 3000, deixando só o domínio.
      </p>
      <div className="flex flex-wrap gap-2">
        <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="painel.seudominio.com" className="input max-w-xs" />
        <button onClick={handleVerify} disabled={checking || !domain} className="btn-secondary px-3 py-2 text-sm">
          {checking ? 'Verificando...' : 'Verificar domínio'}
        </button>
        {reachable && (
          <button onClick={handleLock} disabled={locking} className="btn-danger px-3 py-2 text-sm">
            {locking ? 'Aplicando...' : 'Fechar porta 3000'}
          </button>
        )}
      </div>
      {reachable === true && <p className="mt-2 text-sm text-green-600 dark:text-green-400">Domínio respondendo — pode fechar a porta 3000.</p>}
      {reachable === false && <p className="mt-2 text-sm text-amber-600 dark:text-amber-400">Domínio ainda não está respondendo em HTTPS.</p>}
      {lockMessage && (
        <div className="mt-2">
          <Alert variant="success">{lockMessage}</Alert>
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
    <div>
      <div className="flex flex-col overflow-hidden rounded-2xl border border-slate-800 bg-[#111318]">
        <div className="flex items-center gap-3 border-b border-white/5 bg-[#16181f] px-4 py-2.5">
          <div className="flex shrink-0 gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
          </div>
          <span className="flex items-center gap-1.5 text-xs text-slate-400">
            <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} />
            {status === 'connecting' && 'Conectando...'}
            {status === 'connected' && 'Conectado'}
            {status === 'closed' && 'Desconectado'}
            {status === 'error' && 'Falha na conexão do terminal'}
          </span>
        </div>
        <div ref={containerRef} className="h-[70vh] overflow-hidden bg-[#0a0a0f] p-3" />
      </div>
    </div>
  );
}

interface DatabaseInstanceSummary {
  id: string;
  name: string;
  engine: string;
  containerName: string;
  port: number;
  role: 'STANDALONE' | 'PRIMARY' | 'REPLICA';
  status: string;
  databaseName: string;
  version: string | null;
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

      <div className="space-y-2">
        {instances.map((inst) => {
          const running = inst.status === 'ONLINE';
          const busy = instanceLoading === inst.id;
          return (
            <div
              key={inst.id}
              className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3 text-sm hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900"
            >
              <Link href={`/databases/${inst.id}`} className="flex flex-1 items-center justify-between">
                <span className="font-medium">{inst.name}</span>
                <span className="mr-4 text-xs text-slate-400">
                  {inst.engine} · porta {inst.port} · {inst.role} · {inst.status}
                </span>
              </Link>
              <div className="flex items-center gap-1">
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
            </div>
          );
        })}
        {instances.length === 0 && <p className="text-sm text-slate-400">Nenhum banco instalado neste servidor.</p>}
      </div>

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
          <label className="mb-2 flex items-center gap-2 border-b border-slate-200 pb-2 text-sm font-medium dark:border-slate-800">
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

function QuickReplicateModal({
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
