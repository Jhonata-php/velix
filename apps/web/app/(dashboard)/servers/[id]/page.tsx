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
  lastCheckedAt: string | null;
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

export default function ServerDetailPage() {
  const params = useParams<{ id: string }>();
  const [server, setServer] = useState<Server | null>(null);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [domains, setDomains] = useState<DnsMatch[] | null>(null);
  const [domainsError, setDomainsError] = useState<string | null>(null);

  function load() {
    apiFetch<Server>(`/servers/${params.id}`).then(setServer);
  }

  useEffect(load, [params.id]);

  async function handleTest() {
    setTesting(true);
    setResult(null);
    try {
      const res = await apiFetch<TestResult>(`/servers/${params.id}/test-connection`, { method: 'POST' });
      setResult(res);
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : 'Falha ao testar conexão' });
    } finally {
      setTesting(false);
      load();
    }
  }

  async function handleLookupDomains() {
    if (!server) return;
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

  if (!server) return null;

  return (
    <div className="max-w-2xl">
      <h1 className="mb-1 text-xl font-semibold">{server.name}</h1>
      <p className="mb-6 text-sm text-slate-500">
        {server.sshUser}@{server.publicIp ?? server.privateIp ?? server.hostname}:{server.sshPort}
      </p>

      <div className="mb-6 grid grid-cols-2 gap-4 rounded-xl border border-slate-200 p-4 text-sm dark:border-slate-800">
        <Info label="Status" value={server.status} />
        <Info label="Sistema operacional" value={server.osName ? `${server.osName} ${server.osVersion ?? ''}` : '—'} />
        <Info label="Última verificação" value={server.lastCheckedAt ? new Date(server.lastCheckedAt).toLocaleString('pt-BR') : 'nunca'} />
      </div>

      <button
        onClick={handleTest}
        disabled={testing}
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-white dark:text-slate-900"
      >
        {testing ? 'Testando conexão...' : 'Testar conexão'}
      </button>

      {result && (
        <p className={`mt-4 text-sm ${result.ok ? 'text-green-600' : 'text-red-500'}`}>{result.message}</p>
      )}

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

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-slate-500">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}
