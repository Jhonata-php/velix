'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';

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

  function load() {
    apiFetch<Server[]>('/servers').then(setServers).catch((e) => setError(e.message));
  }

  useEffect(load, []);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Servidores</h1>
        <button
          onClick={() => setShowForm(true)}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 dark:bg-white dark:text-slate-900"
        >
          Adicionar servidor
        </button>
      </div>

      {error && <p className="mb-4 text-sm text-red-500">{error}</p>}

      <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-500 dark:bg-slate-900">
            <tr>
              <th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">IP</th>
              <th className="px-4 py-3">Usuário SSH</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {servers.map((s) => (
              <tr key={s.id} className="border-t border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900">
                <td className="px-4 py-3">
                  <Link href={`/servers/${s.id}`} className="font-medium hover:underline">
                    {s.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-slate-500">{s.publicIp ?? s.privateIp ?? '—'}</td>
                <td className="px-4 py-3 text-slate-500">{s.sshUser}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-1 text-xs font-medium ${STATUS_STYLE[s.status]}`}>{s.status}</span>
                </td>
              </tr>
            ))}
            {servers.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-slate-400">
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
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/40 p-4">
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
          <Field label="Chave privada">
            <textarea
              required
              rows={4}
              value={form.privateKey}
              onChange={(e) => setForm({ ...form, privateKey: e.target.value })}
              className="input font-mono text-xs"
            />
          </Field>
        )}

        {error && <p className="mb-3 text-sm text-red-500">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-white dark:text-slate-900"
          >
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
