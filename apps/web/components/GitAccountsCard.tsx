'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { Alert } from './Alert';
import { ConfirmModal } from './Modal';
import { IconGithub, IconPlus, IconTrash } from './icons';

interface GitAccount {
  id: string;
  label: string;
  host: string;
  username: string | null;
  tokenHint: string;
}

const HOSTS = ['github.com', 'gitlab.com', 'bitbucket.org', 'codeberg.org'];

/**
 * Contas de forja usadas para clonar repositórios privados.
 *
 * O token é enviado uma vez e guardado cifrado; a API devolve só o rótulo, o
 * host e os quatro últimos caracteres. Não há edição de token por isso mesmo —
 * para trocar, remove-se a conta e cria-se outra, o que também deixa explícito
 * que o valor antigo não fica pendurado em lugar nenhum.
 */
export function GitAccountsCard() {
  const [accounts, setAccounts] = useState<GitAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<GitAccount | null>(null);

  const [label, setLabel] = useState('');
  const [host, setHost] = useState('github.com');
  const [username, setUsername] = useState('');
  const [token, setToken] = useState('');

  function load() {
    apiFetch<GitAccount[]>('/git-accounts')
      .then(setAccounts)
      .catch((e) => setError(e instanceof Error ? e.message : 'Falha ao carregar'));
  }

  useEffect(load, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiFetch('/git-accounts', {
        method: 'POST',
        body: JSON.stringify({ label: label.trim(), host, username: username.trim() || undefined, token: token.trim() }),
      });
      setAdding(false);
      setLabel('');
      setUsername('');
      setToken('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar a conta');
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    if (!removing) return;
    try {
      await apiFetch(`/git-accounts/${removing.id}`, { method: 'DELETE' });
      setRemoving(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao remover');
    }
  }

  return (
    <section className="card p-5">
      <div className="mb-1 flex items-start justify-between gap-3">
        <div>
          <h2 className="section-title">Contas de repositório</h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Tokens usados para clonar repositórios privados ao implantar do GitHub, GitLab, Bitbucket ou Codeberg.
          </p>
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
        <form onSubmit={handleSave} className="mt-4 space-y-3 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Nome</span>
              <input required value={label} onChange={(e) => setLabel(e.target.value)} className="input" placeholder="Minha conta pessoal" />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Serviço</span>
              <select value={host} onChange={(e) => setHost(e.target.value)} className="input">
                {HOSTS.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="block text-sm">
            <span className="mb-1 block font-medium">Usuário (opcional)</span>
            <input value={username} onChange={(e) => setUsername(e.target.value)} className="input" placeholder="seu-usuario" />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block font-medium">Token de acesso</span>
            <input required type="password" value={token} onChange={(e) => setToken(e.target.value)} className="input" placeholder="ghp_..." />
            <span className="mt-1 block text-[11px] leading-relaxed text-slate-400">
              Crie um token com permissão apenas de <strong>leitura de repositórios</strong>. Ele é guardado cifrado, nunca
              volta em nenhuma resposta da API e é removido dos logs de implantação.
            </span>
          </label>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setAdding(false)} className="rounded-lg px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="btn-primary px-3 py-1.5 text-xs">
              {saving ? 'Salvando...' : 'Salvar conta'}
            </button>
          </div>
        </form>
      )}

      {accounts && accounts.length > 0 && (
        <div className="mt-4 divide-y divide-slate-200 dark:divide-slate-700">
          {accounts.map((a) => (
            <div key={a.id} className="flex items-center gap-3 py-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                <IconGithub className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{a.label}</p>
                <p className="truncate text-xs text-slate-400">
                  {a.host}
                  {a.username ? ` · ${a.username}` : ''} · token ····{a.tokenHint}
                </p>
              </div>
              <button
                onClick={() => setRemoving(a)}
                aria-label={`Remover ${a.label}`}
                className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-red-500/10 hover:text-red-500"
              >
                <IconTrash className="h-4 w-4" aria-hidden />
              </button>
            </div>
          ))}
        </div>
      )}

      {accounts && accounts.length === 0 && !adding && (
        <p className="mt-3 text-sm text-slate-400">Nenhuma conta salva. Repositórios públicos não precisam de token.</p>
      )}

      {removing && (
        <ConfirmModal
          title="Remover conta"
          message={`Remover "${removing.label}"? As aplicações que usam esta conta continuam rodando, mas param de conseguir clonar o repositório em novas implantações.`}
          confirmLabel="Remover"
          danger
          onConfirm={handleRemove}
          onCancel={() => setRemoving(null)}
        />
      )}
    </section>
  );
}
