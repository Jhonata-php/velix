'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';

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
  lastCheckedAt: string | null;
}

const TABS = [
  { key: 'overview', label: 'Visão geral' },
  { key: 'updates', label: 'Atualizações' },
  { key: 'docker', label: 'Docker' },
  { key: 'easypanel', label: 'EasyPanel' },
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
    <div className="max-w-3xl">
      <h1 className="mb-1 text-xl font-semibold">{server.name}</h1>
      <p className="mb-6 text-sm text-slate-500">
        {server.sshUser}@{server.publicIp ?? server.privateIp ?? server.hostname}:{server.sshPort}
      </p>

      <div className="mb-6 flex gap-1 border-b border-slate-200 dark:border-slate-800">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium ${
              tab === t.key
                ? 'border-b-2 border-slate-900 text-slate-900 dark:border-white dark:text-white'
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

  return (
    <div>
      <div className="mb-6 grid grid-cols-2 gap-4 rounded-xl border border-slate-200 p-4 text-sm dark:border-slate-800">
        <Info label="Status" value={server.status} />
        <Info label="Sistema operacional" value={server.osName ? `${server.osName} ${server.osVersion ?? ''}` : '—'} />
        <Info label="Última verificação" value={server.lastCheckedAt ? new Date(server.lastCheckedAt).toLocaleString('pt-BR') : 'nunca'} />
        <Info label="Docker" value={server.dockerInstalled ? `instalado (${server.dockerVersion})` : 'não instalado'} />
      </div>

      <button
        onClick={handleTest}
        disabled={testing}
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-white dark:text-slate-900"
      >
        {testing ? 'Testando conexão...' : 'Testar conexão'}
      </button>

      {result && <p className={`mt-4 text-sm ${result.ok ? 'text-green-600' : 'text-red-500'}`}>{result.message}</p>}

      <div className="mt-8 border-t border-slate-200 pt-6 dark:border-slate-800">
        <h2 className="mb-2 text-base font-medium">Domínios Cloudflare</h2>
        <p className="mb-3 text-sm text-slate-500">Localiza registros DNS que apontam para o IP público deste servidor.</p>
        <button
          onClick={handleLookupDomains}
          disabled={lookingUp}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          {lookingUp ? 'Buscando...' : 'Localizar domínios'}
        </button>

        {domainsError && <p className="mt-3 text-sm text-red-500">{domainsError}</p>}

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
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
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
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-white dark:text-slate-900"
            >
              {installing ? 'Instalando...' : `Instalar todas (${info.total})`}
            </button>
          </>
        )}
      </div>

      {error && <p className="mb-3 text-sm text-red-500">{error}</p>}

      {info && (
        <p className="mb-3 text-sm text-slate-500">
          Gerenciador: {info.packageManager} · {info.total} pacote(s) desatualizado(s), {info.security} de segurança
        </p>
      )}

      {info && info.packages.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
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
        <pre className="mt-4 max-h-80 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">
          {output.stdout}
          {output.stderr}
        </pre>
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
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-white dark:text-slate-900"
        >
          {installing ? 'Instalando Docker (pode levar alguns minutos)...' : 'Instalar Docker'}
        </button>
        {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
        {output && (
          <pre className="mt-4 max-h-80 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">{output.stdout}</pre>
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
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          Atualizar
        </button>
      </div>

      {error && <p className="mb-3 text-sm text-red-500">{error}</p>}

      <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
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
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-white dark:text-slate-900"
          >
            {installing ? 'Instalando EasyPanel (pode levar alguns minutos)...' : 'Instalar EasyPanel'}
          </button>
        </form>

        {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
        {warnings.map((w) => (
          <p key={w} className="mt-2 text-sm text-amber-600 dark:text-amber-400">
            ⚠️ {w}
          </p>
        ))}
        {output && <pre className="mt-4 max-h-80 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">{output.stdout}</pre>}
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
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          Atualizar
        </button>
      </div>

      {error && <p className="mb-3 text-sm text-red-500">{error}</p>}

      <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
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
