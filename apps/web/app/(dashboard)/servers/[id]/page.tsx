'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { apiFetch, getToken } from '@/lib/api';
import { useAutoRefresh } from '@/lib/useAutoRefresh';
import { Bar } from '@/components/Bar';
import { Alert, CommandOutput as OutputBlock } from '@/components/Alert';
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
    <div className={tab === 'terminal' ? '' : 'max-w-3xl'}>
      <h1 className="mb-1 text-xl font-semibold">{server.name}</h1>
      <p className="mb-6 text-sm text-slate-500">
        {server.sshUser}@{server.publicIp ?? server.privateIp ?? server.hostname}:{server.sshPort}
      </p>

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
      <div className="mb-4 flex items-center justify-between">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
            server.status === 'ONLINE'
              ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400'
              : server.status === 'PENDING'
                ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400'
                : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400'
          }`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          {server.status}
        </span>
        <button onClick={collectMetrics} disabled={collecting} className="btn-secondary px-3 py-1.5 text-xs">
          {collecting ? 'Atualizando...' : '↻ Atualizar agora'}
        </button>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 rounded-xl border border-slate-200 p-4 text-sm dark:border-slate-800">
        <Info label="Sistema operacional" value={server.osName ? `${server.osName} ${server.osVersion ?? ''}` : '—'} />
        <Info label="Uptime" value={server.metrics?.uptimeText ?? '—'} />
        <Info label="Load average" value={server.metrics?.loadAvg ? server.metrics.loadAvg.join(', ') : '—'} />
        <Info label="Docker" value={server.dockerInstalled ? `instalado (${server.dockerVersion})` : 'não instalado'} />

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

      <div className="mt-8 border-t border-slate-200 pt-6 dark:border-slate-800">
        <h2 className="mb-2 text-base font-medium">Domínios Cloudflare</h2>
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

interface CommandOutput {
  ok: boolean;
  stdout: string;
  stderr: string;
  message?: string;
}

function UpdatesTab({ serverId }: { serverId: string }) {
  const [checking, setChecking] = useState(false);
  const [info, setInfo] = useState<UpdatesInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [output, setOutput] = useState<CommandOutput | null>(null);

  async function handleCheck() {
    setChecking(true);
    setError(null);
    setOutput(null);
    try {
      const res = await apiFetch<UpdatesInfo>(`/servers/${serverId}/updates`);
      setInfo(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao verificar atualizações');
    } finally {
      setChecking(false);
    }
  }

  async function handleInstall(securityOnly: boolean) {
    setInstalling(true);
    setOutput(null);
    setError(null);
    try {
      const res = await apiFetch<CommandOutput>(`/servers/${serverId}/updates/install`, {
        method: 'POST',
        body: JSON.stringify({ securityOnly }),
      });
      setOutput(res);
      handleCheck();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao instalar atualizações');
    } finally {
      setInstalling(false);
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
              onClick={() => handleInstall(true)}
              disabled={installing || info.security === 0}
              className="rounded-lg border border-amber-300 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-900/20"
            >
              Instalar só segurança ({info.security})
            </button>
            <button
              onClick={() => handleInstall(false)}
              disabled={installing}
              className="btn-primary px-4 py-2 text-sm"
            >
              {installing ? 'Instalando...' : `Instalar todas (${info.total})`}
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

      {output && (
        <div className="mt-4">
          <Alert variant={output.ok ? 'success' : 'error'} title={output.ok ? 'Atualização concluída' : 'Falha na atualização'}>
            <OutputBlock>
              {output.stdout}
              {output.stderr}
            </OutputBlock>
          </Alert>
        </div>
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
  const [installing, setInstalling] = useState(false);
  const [output, setOutput] = useState<CommandOutput | null>(null);
  const [status, setStatus] = useState<DockerStatusResp | null>(null);
  const [error, setError] = useState<string | null>(null);

  function loadStatus() {
    apiFetch<DockerStatusResp>(`/servers/${server.id}/docker/status`)
      .then(setStatus)
      .catch((e) => setError(e.message));
  }

  useEffect(() => {
    if (server.dockerInstalled) loadStatus();
  }, [server.dockerInstalled]);
  useAutoRefresh(() => server.dockerInstalled && loadStatus(), 10_000);

  async function handleInstall() {
    setInstalling(true);
    setOutput(null);
    setError(null);
    try {
      const res = await apiFetch<{ ok: boolean; output: string; version: string | null }>(`/servers/${server.id}/docker/install`, {
        method: 'POST',
      });
      setOutput({ ok: res.ok, stdout: res.output, stderr: '' });
      onChange();
      loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao instalar Docker');
    } finally {
      setInstalling(false);
    }
  }

  if (!server.dockerInstalled) {
    return (
      <div>
        <p className="mb-4 text-sm text-slate-500">Docker ainda não foi instalado neste servidor.</p>
        <button
          onClick={handleInstall}
          disabled={installing}
          className="btn-primary px-4 py-2 text-sm"
        >
          {installing ? 'Instalando Docker (pode levar alguns minutos)...' : 'Instalar Docker'}
        </button>
        {error && (
          <div className="mt-3">
            <Alert variant="error">{error}</Alert>
          </div>
        )}
        {output && (
          <div className="mt-4">
            <Alert variant={output.ok ? 'success' : 'error'} title={output.ok ? 'Docker instalado' : 'Falha na instalação'}>
              <OutputBlock>{output.stdout}</OutputBlock>
            </Alert>
          </div>
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
  const [email, setEmail] = useState('');
  const [createDnsRecord, setCreateDnsRecord] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [output, setOutput] = useState<{ stdout: string } | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<EasyPanelStatusResp | null>(null);

  function loadStatus() {
    apiFetch<EasyPanelStatusResp>(`/servers/${server.id}/easypanel/status`)
      .then(setStatus)
      .catch((e) => setError(e.message));
  }

  useEffect(() => {
    if (server.easypanelInstalled) loadStatus();
  }, [server.easypanelInstalled]);
  useAutoRefresh(() => server.easypanelInstalled && loadStatus(), 10_000);

  if (!server.dockerInstalled) {
    return <p className="text-sm text-slate-500">Instale o Docker (aba Docker) antes de instalar o EasyPanel.</p>;
  }

  async function handleInstall(e: React.FormEvent) {
    e.preventDefault();
    setInstalling(true);
    setOutput(null);
    setWarnings([]);
    setError(null);
    try {
      const res = await apiFetch<{ ok: boolean; output: string; url: string | null; warnings: string[] }>(
        `/servers/${server.id}/easypanel/install`,
        { method: 'POST', body: JSON.stringify({ domain: domain || undefined, email, createDnsRecord }) },
      );
      setOutput({ stdout: res.output });
      setWarnings(res.warnings);
      onChange();
      if (res.ok) loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao instalar EasyPanel');
    } finally {
      setInstalling(false);
    }
  }

  if (!server.easypanelInstalled) {
    return (
      <div>
        <form onSubmit={handleInstall} className="max-w-sm space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Domínio (opcional)</span>
            <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="painel.seudominio.com" className="input" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">E-mail administrativo</span>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="input" />
          </label>
          {domain && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={createDnsRecord} onChange={(e) => setCreateDnsRecord(e.target.checked)} />
              Criar registro DNS na Cloudflare automaticamente
            </label>
          )}
          <button
            type="submit"
            disabled={installing}
            className="btn-primary px-4 py-2 text-sm"
          >
            {installing ? 'Instalando EasyPanel (pode levar alguns minutos)...' : 'Instalar EasyPanel'}
          </button>
        </form>

        {error && (
          <div className="mt-3">
            <Alert variant="error">{error}</Alert>
          </div>
        )}
        {warnings.length > 0 && (
          <div className="mt-3 space-y-2">
            {warnings.map((w) => (
              <Alert key={w} variant="warning">
                {w}
              </Alert>
            ))}
          </div>
        )}
        {output && (
          <div className="mt-4">
            <Alert variant="info" title="Saída da instalação">
              <OutputBlock>{output.stdout}</OutputBlock>
            </Alert>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <a href={server.easypanelUrl ?? '#'} target="_blank" rel="noreferrer" className="text-sm font-medium text-blue-600 hover:underline dark:text-blue-400">
          Abrir EasyPanel ({server.easypanelUrl})
        </a>
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ rootPassword: string; appPassword: string; warnings: string[] } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch<{ rootPassword: string; appPassword: string; warnings: string[] }>(
        `/servers/${serverId}/databases`,
        { method: 'POST', body: JSON.stringify(form) },
      );
      setCreated(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao instalar MySQL');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center overflow-y-auto bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-lg dark:border-slate-800 dark:bg-slate-900">
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
          <form onSubmit={handleSubmit}>
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
            {error && (
              <div className="mb-3">
                <Alert variant="error">{error}</Alert>
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="btn-primary px-4 py-2 text-sm"
              >
                {saving ? 'Instalando (leva um tempinho)...' : 'Instalar'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
