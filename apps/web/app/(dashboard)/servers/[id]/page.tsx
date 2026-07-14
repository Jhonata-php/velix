'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { apiFetch, getToken } from '@/lib/api';
import { useAutoRefresh } from '@/lib/useAutoRefresh';
import { Bar } from '@/components/Bar';
import { Alert } from '@/components/Alert';
import { InstallLogModal } from '@/components/InstallLogModal';
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
  const [server, setServer] = useState<Server | null>(null);
  const [tab, setTab] = useState<TabKey>('overview');

  function load() {
    apiFetch<Server>(`/servers/${params.id}`).then(setServer);
  }

  useEffect(load, [params.id]);

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
        <StatusPill status={server.status} />
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        <Badge ok={server.dockerInstalled} label={server.dockerInstalled ? `Docker ${server.dockerVersion ?? ''}` : 'Docker não instalado'} />
        <Badge
          ok={server.easypanelInstalled}
          label={server.easypanelInstalled ? 'EasyPanel instalado' : 'EasyPanel não instalado'}
        />
      </div>

      <div className="mb-6 flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-800">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`whitespace-nowrap px-4 py-2 text-sm font-medium ${
              tab === t.key
                ? 'border-b-2 border-indigo-600 text-indigo-700 dark:border-indigo-400 dark:text-indigo-400'
                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
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

const STATUS_PILL_STYLE: Record<string, string> = {
  ONLINE: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400',
  PENDING: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
  OFFLINE: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  ERROR: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
};

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
        STATUS_PILL_STYLE[status] ?? STATUS_PILL_STYLE.OFFLINE
      }`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {status}
    </span>
  );
}

function Badge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
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

  function collectMetrics() {
    setCollecting(true);
    apiFetch(`/servers/${server.id}/metrics`)
      .then(onChange)
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

      <div className="card mb-6 grid grid-cols-2 gap-6 p-5 text-sm sm:grid-cols-3 lg:grid-cols-5">
        <Info label="Sistema operacional" value={server.osName ? `${server.osName} ${server.osVersion ?? ''}` : '—'} />
        <Info label="Uptime" value={server.metrics?.uptimeText ?? '—'} />
        <Info label="Load average" value={server.metrics?.loadAvg ? server.metrics.loadAvg.join(', ') : '—'} />

        <div>
          <p className="text-slate-500">Memória</p>
          {memPercent !== null ? (
            <div className="mt-1 flex items-center gap-2">
              <Bar percent={memPercent} />
              <span className="text-xs">
                {server.metrics?.memUsedMb}MB / {server.metrics?.memTotalMb}MB
              </span>
            </div>
          ) : (
            <p className="font-medium">—</p>
          )}
        </div>
        <div>
          <p className="text-slate-500">Disco</p>
          {diskPercent !== null ? (
            <div className="mt-1 flex items-center gap-2">
              <Bar percent={diskPercent} />
              <span className="text-xs">
                {server.metrics?.diskUsed} / {server.metrics?.diskTotal}
              </span>
            </div>
          ) : (
            <p className="font-medium">—</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="card p-5">
          <h2 className="section-title mb-3">Ações</h2>
          <div className="flex flex-wrap gap-2">
            <button onClick={handleTest} disabled={testing} className="btn-primary px-4 py-2 text-sm">
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
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500 dark:bg-slate-900">
              <tr>
                <th className="px-4 py-2">Pacote</th>
                <th className="px-4 py-2">Versão</th>
                <th className="px-4 py-2">Segurança</th>
              </tr>
            </thead>
            <tbody>
              {info.packages.map((p) => (
                <tr key={p.name} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-4 py-2">{p.name}</td>
                  <td className="px-4 py-2 text-slate-500">{p.version}</td>
                  <td className="px-4 py-2">{p.security ? '⚠️ sim' : '—'}</td>
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

  function loadStatus() {
    apiFetch<DockerStatusResp>(`/servers/${server.id}/docker/status`)
      .then(setStatus)
      .catch((e) => setError(e.message));
  }

  useEffect(() => {
    if (server.dockerInstalled) loadStatus();
  }, [server.dockerInstalled]);
  useAutoRefresh(() => server.dockerInstalled && loadStatus(), 10_000);

  if (!server.dockerInstalled) {
    return (
      <div>
        <p className="mb-4 text-sm text-slate-500">Docker ainda não foi instalado neste servidor.</p>
        <button onClick={() => setShowLog(true)} className="btn-primary px-4 py-2 text-sm">
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
        <button
          onClick={loadStatus}
          className="btn-secondary px-3 py-1.5 text-xs"
        >
          ↻ Atualizar
        </button>
      </div>

      {error && (
        <div className="mb-3">
          <Alert variant="error">{error}</Alert>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-500 dark:bg-slate-900">
            <tr>
              <th className="px-4 py-2">Container</th>
              <th className="px-4 py-2">Imagem</th>
              <th className="px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {status?.containers?.map((c) => (
              <tr key={c.id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-4 py-2">{c.names}</td>
                <td className="px-4 py-2 text-slate-500">{c.image}</td>
                <td className="px-4 py-2">{c.status}</td>
              </tr>
            ))}
            {(!status?.containers || status.containers.length === 0) && (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-slate-400">
                  Nenhum container em execução.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
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
          <button type="submit" className="btn-primary px-4 py-2 text-sm">
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
        <button onClick={loadStatus} className="btn-secondary px-3 py-1.5 text-xs">
          ↻ Atualizar
        </button>
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
              <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Container</th>
              <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Imagem</th>
              <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
            </tr>
          </thead>
          <tbody>
            {status?.containers?.map((c) => (
              <tr key={c.id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-4 py-2">{c.names}</td>
                <td className="px-4 py-2 text-slate-500">{c.image}</td>
                <td className="px-4 py-2">{c.status}</td>
              </tr>
            ))}
            {(!status?.containers || status.containers.length === 0) && (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-slate-400">
                  Nenhum container encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
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
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        theme: { background: '#0f172a' },
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

  return (
    <div>
      <p className="mb-2 text-xs text-slate-400">
        {status === 'connecting' && 'Conectando...'}
        {status === 'connected' && 'Conectado'}
        {status === 'closed' && 'Desconectado'}
        {status === 'error' && 'Falha na conexão do terminal'}
      </p>
      <div ref={containerRef} className="h-[70vh] overflow-hidden rounded-xl border border-slate-800 bg-[#0f172a] p-2" />
    </div>
  );
}

interface DatabaseInstanceSummary {
  id: string;
  name: string;
  engine: string;
  port: number;
  role: 'STANDALONE' | 'PRIMARY' | 'REPLICA';
  status: string;
  databaseName: string;
  version: string | null;
}

function DatabasesTab({ server }: { server: Server }) {
  const [instances, setInstances] = useState<DatabaseInstanceSummary[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    apiFetch<DatabaseInstanceSummary[]>(`/servers/${server.id}/databases`)
      .then(setInstances)
      .catch((e) => setError(e.message));
  }

  useEffect(load, [server.id]);

  if (!server.dockerInstalled) {
    return <p className="text-sm text-slate-500">Instale o Docker (aba Docker) antes de criar um banco de dados.</p>;
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-medium">Instâncias MySQL</h2>
        <button
          onClick={() => setShowForm(true)}
          className="btn-primary px-4 py-2 text-sm"
        >
          Instalar MySQL
        </button>
      </div>

      {error && (
        <div className="mb-3">
          <Alert variant="error">{error}</Alert>
        </div>
      )}

      <div className="space-y-2">
        {instances.map((inst) => (
          <Link
            key={inst.id}
            href={`/databases/${inst.id}`}
            className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3 text-sm hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900"
          >
            <span className="font-medium">{inst.name}</span>
            <span className="text-xs text-slate-400">
              {inst.engine} · porta {inst.port} · {inst.role} · {inst.status}
            </span>
          </Link>
        ))}
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
    </div>
  );
}

function InstallMysqlModal({ serverId, onClose, onCreated }: { serverId: string; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ name: '', databaseName: 'app', appUser: 'app' });
  const [showLog, setShowLog] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ rootPassword: string; appPassword: string; warnings: string[] } | null>(null);

  function handleDone(ok: boolean, result: unknown) {
    const res = result as { rootPassword: string; appPassword: string; warnings: string[]; status: string };
    if (ok) {
      setCreated(res);
    } else {
      setError(`Falha ao instalar MySQL (status: ${res?.status ?? 'desconhecido'}) — veja o log acima.`);
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
    <div className="fixed inset-0 flex items-center justify-center overflow-y-auto bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-lg dark:border-slate-800 dark:bg-slate-900">
        {error && (
          <div className="mb-3">
            <Alert variant="error">{error}</Alert>
          </div>
        )}
        {created ? (
          <div>
            <h2 className="mb-3 text-lg font-semibold">MySQL instalado</h2>
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
            <h2 className="mb-4 text-lg font-semibold">Instalar MySQL</h2>
            <label className="mb-3 block text-sm">
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
      </div>
    </div>
  );
}
