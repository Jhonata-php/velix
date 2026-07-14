'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/api';
import { Alert } from '@/components/Alert';
import { Modal } from '@/components/Modal';

interface ServerLike {
  id: string;
  name: string;
  publicIp: string | null;
  sshPort: number;
  sshUser: string;
  authMethod: 'PASSWORD' | 'PRIVATE_KEY';
}

export function ServerFormModal({ server, onClose, onSaved }: { server?: ServerLike; onClose: () => void; onSaved: () => void }) {
  const isEdit = !!server;
  const [form, setForm] = useState({
    name: server?.name ?? '',
    publicIp: server?.publicIp ?? '',
    sshPort: server?.sshPort ?? 22,
    sshUser: server?.sshUser ?? 'root',
    authMethod: server?.authMethod ?? ('PASSWORD' as 'PASSWORD' | 'PRIVATE_KEY'),
    password: '',
    privateKey: '',
  });
  const [changeCredential, setChangeCredential] = useState(!isEdit);
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
      const includeCredential = !isEdit || changeCredential;
      const body = {
        name: form.name,
        publicIp: form.publicIp,
        sshPort: form.sshPort,
        sshUser: form.sshUser,
        authMethod: form.authMethod,
        ...(includeCredential ? { password: form.password, privateKey: form.privateKey } : {}),
      };
      if (isEdit) {
        await apiFetch(`/servers/${server!.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      } else {
        await apiFetch('/servers', { method: 'POST', body: JSON.stringify(body) });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Falha ao ${isEdit ? 'salvar' : 'criar'} servidor`);
    } finally {
      setLoading(false);
    }
  }

  const needsCredential = !isEdit || changeCredential;
  const canSubmit = !needsCredential || form.authMethod !== 'PRIVATE_KEY' || keySource === 'paste' || !!generatedKey;

  return (
    <Modal title={isEdit ? 'Editar servidor' : 'Adicionar servidor'} onClose={onClose} closeDisabled={loading}>
      <form onSubmit={handleSubmit}>
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

        {isEdit && (
          <label className="mb-3 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={changeCredential} onChange={(e) => setChangeCredential(e.target.checked)} />
            Trocar credencial de acesso
          </label>
        )}

        {!needsCredential ? null : form.authMethod === 'PASSWORD' ? (
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
            {loading ? 'Salvando...' : isEdit ? 'Salvar alterações' : 'Salvar'}
          </button>
        </div>
      </form>
    </Modal>
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
