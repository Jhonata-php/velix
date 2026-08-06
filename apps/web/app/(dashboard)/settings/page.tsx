'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { Alert } from '@/components/Alert';
import { IconShield, IconChevronRight } from '@/components/icons';

interface AccountStatus {
  connected: boolean;
  id?: string;
  email?: string;
  createdAt?: string;
}

interface Zone {
  id: string;
  name: string;
  status: string;
}

interface DnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  ttl: number;
  proxied: boolean;
}

export default function SettingsPage() {
  const [account, setAccount] = useState<AccountStatus | null>(null);
  const [token, setToken] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zones, setZones] = useState<Zone[]>([]);
  const [zonesError, setZonesError] = useState<string | null>(null);
  const [expandedZone, setExpandedZone] = useState<string | null>(null);

  function loadAccount() {
    apiFetch<AccountStatus>('/cloudflare/account').then(setAccount);
  }

  function loadZones() {
    apiFetch<Zone[]>('/cloudflare/zones')
      .then((z) => {
        setZones(z);
        setZonesError(null);
      })
      .catch((e) => setZonesError(e.message));
  }

  useEffect(loadAccount, []);
  useEffect(() => {
    if (account?.connected) loadZones();
  }, [account?.connected]);

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setConnecting(true);
    try {
      await apiFetch('/cloudflare/account', { method: 'POST', body: JSON.stringify({ apiToken: token }) });
      setToken('');
      loadAccount();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao conectar');
    } finally {
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    await apiFetch('/cloudflare/account', { method: 'DELETE' });
    setZones([]);
    setExpandedZone(null);
    loadAccount();
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="page-title">Configurações</h1>
        <p className="text-xs text-slate-400">Sistema e integrações</p>
      </div>

      <Link href="/settings/security" className="card card-hover flex items-center gap-3 p-4">
        <span className="icon-chip bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
          <IconShield className="h-[18px] w-[18px]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">Segurança</span>
          <span className="block text-xs text-slate-400">Senha, sessões ativas e atividade da conta</span>
        </span>
        <IconChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
      </Link>

      <section className="card p-4">
        <h2 className="section-title mb-1">Cloudflare</h2>
        <p className="mb-4 text-sm text-slate-500">
          Conecte um API Token da Cloudflare para gerenciar zonas e registros DNS diretamente pelo Velix.
        </p>

        {account?.connected ? (
          <div className="flex items-center justify-between rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm dark:border-green-900 dark:bg-green-900/20">
            <span className="flex items-center gap-2 text-green-800 dark:text-green-300">
              <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
              Conectado{account.email ? ` como ${account.email}` : ''}
            </span>
            <button onClick={handleDisconnect} className="text-red-600 hover:underline dark:text-red-400">
              Desconectar
            </button>
          </div>
        ) : (
          <form onSubmit={handleConnect} className="flex gap-2">
            <input
              type="password"
              required
              placeholder="API Token da Cloudflare"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="input"
            />
            <button
              type="submit"
              disabled={connecting}
              className="whitespace-nowrap btn-primary px-4 py-2 text-sm"
            >
              {connecting ? 'Conectando...' : 'Conectar'}
            </button>
          </form>
        )}
        {error && (
          <div className="mt-3">
            <Alert variant="error">{error}</Alert>
          </div>
        )}
      </section>

      {account?.connected && (
        <section className="card p-4">
          <h2 className="section-title mb-3">Zonas</h2>
          {zonesError && (
            <div className="mb-3">
              <Alert variant="error">{zonesError}</Alert>
            </div>
          )}
          <div className="space-y-2">
            {zones.map((zone) => (
              <div key={zone.id} className="rounded-xl border border-slate-200 transition hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-700">
                <button
                  onClick={() => setExpandedZone(expandedZone === zone.id ? null : zone.id)}
                  className="flex w-full items-center justify-between px-4 py-3 text-left text-sm"
                >
                  <span className="font-medium">{zone.name}</span>
                  <span className="text-slate-400">{zone.status}</span>
                </button>
                {expandedZone === zone.id && <ZoneRecords zoneId={zone.id} />}
              </div>
            ))}
            {zones.length === 0 && !zonesError && <p className="text-sm text-slate-400">Nenhuma zona encontrada nesta conta.</p>}
          </div>
        </section>
      )}
    </div>
  );
}

function ZoneRecords({ zoneId }: { zoneId: string }) {
  const [records, setRecords] = useState<DnsRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ type: 'A', name: '', content: '', proxied: false });
  const [saving, setSaving] = useState(false);

  function load() {
    apiFetch<DnsRecord[]>(`/cloudflare/zones/${zoneId}/records`)
      .then(setRecords)
      .catch((e) => setError(e.message));
  }

  useEffect(load, [zoneId]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/cloudflare/zones/${zoneId}/records`, { method: 'POST', body: JSON.stringify(form) });
      setForm({ type: 'A', name: '', content: '', proxied: false });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao criar registro');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(recordId: string) {
    await apiFetch(`/cloudflare/zones/${zoneId}/records/${recordId}`, { method: 'DELETE' });
    load();
  }

  return (
    <div className="border-t border-slate-200 px-4 py-3 dark:border-slate-700">
      {error && (
        <div className="mb-2">
          <Alert variant="error">{error}</Alert>
        </div>
      )}
      <table className="w-full text-left text-xs">
        <thead className="text-slate-500">
          <tr>
            <th className="py-1 pr-2">Tipo</th>
            <th className="py-1 pr-2">Nome</th>
            <th className="py-1 pr-2">Conteúdo</th>
            <th className="py-1 pr-2">Proxy</th>
            <th className="py-1" />
          </tr>
        </thead>
        <tbody>
          {records.map((r) => (
            <tr key={r.id} className="border-t border-slate-100 dark:border-slate-700/60">
              <td className="py-1 pr-2">{r.type}</td>
              <td className="py-1 pr-2">{r.name}</td>
              <td className="py-1 pr-2">{r.content}</td>
              <td className="py-1 pr-2">{r.proxied ? 'Sim' : 'Não'}</td>
              <td className="py-1 text-right">
                <button onClick={() => handleDelete(r.id)} className="text-red-500 hover:underline">
                  Excluir
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <form onSubmit={handleAdd} className="mt-3 flex flex-wrap items-center gap-2">
        <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="input w-20">
          <option>A</option>
          <option>AAAA</option>
          <option>CNAME</option>
          <option>TXT</option>
        </select>
        <input
          required
          placeholder="nome (ex: painel)"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="input w-40"
        />
        <input
          required
          placeholder="conteúdo (ex: IP)"
          value={form.content}
          onChange={(e) => setForm({ ...form, content: e.target.value })}
          className="input w-40"
        />
        <label className="flex items-center gap-1 text-xs">
          <input type="checkbox" checked={form.proxied} onChange={(e) => setForm({ ...form, proxied: e.target.checked })} />
          Proxy
        </label>
        <button
          type="submit"
          disabled={saving}
          className="btn-primary px-3 py-2 text-xs"
        >
          {saving ? 'Salvando...' : 'Adicionar registro'}
        </button>
      </form>
    </div>
  );
}
