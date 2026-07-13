'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { useAutoRefresh } from '@/lib/useAutoRefresh';
import { Alert } from '@/components/Alert';

interface Server {
  id: string;
  name: string;
  publicIp: string | null;
  privateIp: string | null;
  sshUser: string;
  status: 'PENDING' | 'ONLINE' | 'OFFLINE' | 'ERROR';
}

const STATUS_STYLE: Record<Server['status'], string> = {
  ONLINE: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400',
  OFFLINE: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  ERROR: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
  PENDING: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
};

export default function ServersPage() {
  const [servers, setServers] = useState<Server[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  function load() {
    setRefreshing(true);
    apiFetch<Server[]>('/servers')
      .then(setServers)
      .catch((e) => setError(e.message))
      .finally(() => setRefreshing(false));
  }

  useEffect(load, []);
  useAutoRefresh(load, 10_000);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Servidores</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            title="Atualizar agora"
            className="btn-secondary px-3 py-2 text-sm"
          >
            {refreshing ? '…' : '↻'}
          </button>
          <button onClick={() => setShowForm(true)} className="btn-primary px-4 py-2 text-sm">
            Adicionar servidor
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4">
          <Alert variant="error">{error}</Alert>
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 dark:border-slate-800">
            <tr>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Nome</th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">IP</th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Usuário SSH</th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
            </tr>
          </thead>
          <tbody>
            {servers.map((s) => (
              <tr key={s.id} className="border-t border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40">
                <td className="px-4 py-3.5">
                  <Link href={`/servers/${s.id}`} className="font-medium hover:text-indigo-600 dark:hover:text-indigo-400">
                    {s.name}
                  </Link>
                </td>
                <td className="px-4 py-3.5 text-slate-500">{s.publicIp ?? s.privateIp ?? '—'}</td>
                <td className="px-4 py-3.5 text-slate-500">{s.sshUser}</td>
                <td className="px-4 py-3.5">
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLE[s.status]}`}>
                    <span className="h-1.5 w-1.5 rounded-full bg-current" />
                    {s.status}
                  </span>
                </td>
              </tr>
            ))}
            {servers.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-slate-400">
                  Nenhum servidor cadastrado ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <AddServerModal
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

function AddServerModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    name: '',
    publicIp: '',
    sshPort: 22,
    sshUser: 'root',
    authMethod: 'PASSWORD' as 'PASSWORD' | 'PRIVATE_KEY',
    password: '',
    privateKey: '',
  });
  const [keySource, setKeySource] = useState<'paste' | 'generate'>('generate');
  const [generatedKey, setGeneratedKey] = useState<{ publicKey: string; command: string } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleGenerateKey() {
    setGenerating(true);
    setError(null);
    try {
      const res = await apiFetch<{ publicKey: string; privateKey: string; command: string }>('/servers/generate-ssh-key', {
        method: 'POST',
      });
      setGeneratedKey({ publicKey: res.publicKey, command: res.command });
      setForm((f) => ({ ...f, privateKey: res.privateKey }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao gerar chave');
    } finally {
      setGenerating(false);
    }
  }

  async function handleCopyCommand() {
    if (!generatedKey) return;
    await navigator.clipboard.writeText(generatedKey.command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await apiFetch('/servers', { method: 'POST', body: JSON.stringify(form) });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao criar servidor');
    } finally {
      setLoading(false);
    }
  }

  const canSubmit = form.authMethod !== 'PRIVATE_KEY' || keySource === 'paste' || !!generatedKey;

  return (
    <div className="fixed inset-0 flex items-center justify-center overflow-y-auto bg-black/40 p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-lg dark:border-slate-800 dark:bg-slate-900"
      >
        <h2 className="mb-4 text-lg font-semibold">Adicionar servidor</h2>

        <Field label="Nome">
          <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input" />
        </Field>
        <Field label="IP público">
          <input required value={form.publicIp} onChange={(e) => setForm({ ...form, publicIp: e.target.value })} className="input" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Porta SSH">
            <input
              type="number"
              value={form.sshPort}
              onChange={(e) => setForm({ ...form, sshPort: Number(e.target.value) })}
              className="input"
            />
          </Field>
          <Field label="Usuário SSH">
            <input required value={form.sshUser} onChange={(e) => setForm({ ...form, sshUser: e.target.value })} className="input" />
          </Field>
        </div>

        <Field label="Método de acesso">
          <select
            value={form.authMethod}
            onChange={(e) => setForm({ ...form, authMethod: e.target.value as 'PASSWORD' | 'PRIVATE_KEY' })}
            className="input"
          >
            <option value="PASSWORD">Senha</option>
            <option value="PRIVATE_KEY">Chave privada SSH</option>
          </select>
        </Field>

        {form.authMethod === 'PASSWORD' ? (
          <Field label="Senha temporária">
            <input
              type="password"
              required
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="input"
            />
          </Field>
        ) : (
          <div className="mb-3">
            <div className="mb-2 flex gap-2 text-sm">
              <button
                type="button"
                onClick={() => setKeySource('generate')}
                className={`rounded-lg px-3 py-1.5 ${keySource === 'generate' ? 'bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-400' : 'text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
              >
                Gerar nova chave
              </button>
              <button
                type="button"
                onClick={() => setKeySource('paste')}
                className={`rounded-lg px-3 py-1.5 ${keySource === 'paste' ? 'bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-400' : 'text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
              >
                Colar chave existente
              </button>
            </div>

            {keySource === 'paste' ? (
              <Field label="Chave privada">
                <textarea
                  required
                  rows={4}
                  value={form.privateKey}
                  onChange={(e) => setForm({ ...form, privateKey: e.target.value })}
                  className="input font-mono text-xs"
                />
              </Field>
            ) : !generatedKey ? (
              <button
                type="button"
                onClick={handleGenerateKey}
                disabled={generating}
                className="btn-secondary w-full px-3 py-2 text-sm"
              >
                {generating ? 'Gerando...' : 'Gerar chave SSH'}
              </button>
            ) : (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs dark:border-amber-900 dark:bg-amber-900/20">
                <p className="mb-2 font-medium text-amber-800 dark:text-amber-300">
                  Antes de salvar, cole e rode este comando no terminal do servidor (via SSH com a senha atual, ou console do provedor):
                </p>
                <pre className="mb-2 overflow-x-auto whitespace-pre-wrap break-all rounded bg-slate-900 p-2 text-slate-100">{generatedKey.command}</pre>
                <button type="button" onClick={handleCopyCommand} className="btn-secondary px-3 py-1.5 text-xs">
                  {copied ? 'Copiado!' : 'Copiar comando'}
                </button>
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="mb-3">
            <Alert variant="error">{error}</Alert>
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
            Cancelar
          </button>
          <button type="submit" disabled={loading || !canSubmit} className="btn-primary px-4 py-2 text-sm">
            {loading ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-3 block text-sm">
      <span className="mb-1 block font-medium">{label}</span>
      {children}
    </label>
  );
}
