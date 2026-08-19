'use client';

import { useEffect, useState } from 'react';
import { apiFetch, getUser } from '@/lib/api';
import { relativeTime } from '@/lib/relativeTime';
import { Alert } from './Alert';
import { ConfirmModal } from './Modal';
import { StatusBadge } from './StatusBadge';
import { IconPlus, IconTrash, IconShield } from './icons';

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'operator' | 'viewer';
  createdAt: string;
  twoFactorEnabled: boolean;
}

const ROLE_LABEL: Record<UserRow['role'], string> = {
  admin: 'Administrador',
  operator: 'Operador',
  viewer: 'Leitor',
};

const ROLE_HELP: Record<UserRow['role'], string> = {
  admin: 'Tudo, incluindo usuários, backup, contas e remoção de servidores.',
  operator: 'Implanta, reinicia e instala. Não mexe em usuários nem em segredos.',
  viewer: 'Só leitura — enxerga tudo, não muda nada.',
};

/**
 * Usuários e perfis.
 *
 * Antes desta tela o campo de papel no token era decorativo: não havia como
 * criar alguém que não fosse administrador, então "todo usuário é admin" era a
 * única realidade possível.
 *
 * A tela não deixa remover nem rebaixar a própria conta, e o servidor recusa
 * tirar o último administrador. As duas coisas acontecem por engano e nenhuma
 * tem desfazer pela interface.
 */
export function UsersCard() {
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<UserRow | null>(null);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'viewer' as UserRow['role'] });

  const me = getUser();

  function load() {
    apiFetch<UserRow[]>('/users')
      .then(setUsers)
      .catch((e) => setError(e instanceof Error ? e.message : 'Falha ao carregar'));
  }
  useEffect(load, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiFetch('/users', { method: 'POST', body: JSON.stringify(form) });
      setAdding(false);
      setForm({ name: '', email: '', password: '', role: 'viewer' });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao criar usuário');
    } finally {
      setSaving(false);
    }
  }

  async function changeRole(user: UserRow, role: UserRow['role']) {
    setError(null);
    try {
      await apiFetch(`/users/${user.id}/role`, { method: 'PATCH', body: JSON.stringify({ role }) });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao alterar perfil');
      load();
    }
  }

  async function handleRemove() {
    if (!removing) return;
    try {
      await apiFetch(`/users/${removing.id}`, { method: 'DELETE' });
      setRemoving(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao remover');
      setRemoving(null);
    }
  }

  // 403 é o caso normal para quem não é admin — mostrar o card vazio seria pior
  // que não mostrar nada.
  if (error?.includes('permissão') || error?.includes('administradores')) return null;

  return (
    <section className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="section-title">Usuários e perfis</h2>
          <p className="mt-0.5 text-xs text-slate-400">Quem acessa o painel e o que cada um pode fazer.</p>
        </div>
        {!adding && (
          <button onClick={() => setAdding(true)} className="btn-secondary flex shrink-0 items-center gap-1.5 px-3 py-1.5 text-xs">
            <IconPlus className="h-3.5 w-3.5" aria-hidden />
            Adicionar
          </button>
        )}
      </div>

      {error && (
        <div className="mt-3">
          <Alert variant="error">{error}</Alert>
        </div>
      )}

      {adding && (
        <form onSubmit={handleCreate} className="mt-4 space-y-3 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Nome</span>
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input" />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">E-mail</span>
              <input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="input" />
            </label>
          </div>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Senha inicial</span>
            <input required type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="input" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Perfil</span>
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as UserRow['role'] })} className="input">
              {(Object.keys(ROLE_LABEL) as UserRow['role'][]).map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-[11px] text-slate-400">{ROLE_HELP[form.role]}</span>
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setAdding(false)} className="rounded-lg px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="btn-primary px-3 py-1.5 text-xs">
              {saving ? 'Criando...' : 'Criar usuário'}
            </button>
          </div>
        </form>
      )}

      {users && (
        <div className="mt-4 divide-y divide-slate-200 dark:divide-slate-700">
          {users.map((u) => {
            const isMe = me?.email === u.email;
            return (
              <div key={u.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-indigo-700 text-xs font-semibold text-white">
                  {u.name.charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                    {u.name}
                    {isMe && <span className="text-[10px] font-normal text-indigo-500">você</span>}
                    {u.twoFactorEnabled && (
                      <span title="Verificação em duas etapas ativa">
                        <IconShield className="h-3.5 w-3.5 text-green-500" aria-hidden />
                      </span>
                    )}
                  </p>
                  <p className="truncate text-xs text-slate-400">
                    {u.email} · desde {relativeTime(u.createdAt)}
                  </p>
                </div>

                {isMe ? (
                  <StatusBadge tone="neutral">{ROLE_LABEL[u.role]}</StatusBadge>
                ) : (
                  <select
                    value={u.role}
                    onChange={(e) => changeRole(u, e.target.value as UserRow['role'])}
                    className="input h-8 w-auto py-0 text-xs"
                    aria-label={`Perfil de ${u.name}`}
                  >
                    {(Object.keys(ROLE_LABEL) as UserRow['role'][]).map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </select>
                )}

                <button
                  onClick={() => setRemoving(u)}
                  disabled={isMe}
                  aria-label={`Remover ${u.name}`}
                  title={isMe ? 'Você não pode remover a própria conta' : 'Remover'}
                  className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-red-500/10 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400"
                >
                  <IconTrash className="h-4 w-4" aria-hidden />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {removing && (
        <ConfirmModal
          title="Remover usuário"
          message={`Remover "${removing.name}"? As sessões dele são encerradas na hora. Nada implantado por ele é afetado.`}
          confirmLabel="Remover"
          danger
          onConfirm={handleRemove}
          onCancel={() => setRemoving(null)}
        />
      )}
    </section>
  );
}
