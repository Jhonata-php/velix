'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import type { BackupDestinationSummary } from '@/lib/types';
import { Alert } from './Alert';
import { ConfirmModal } from './Modal';
import { IconPlus, IconTrash } from './icons';

/**
 * Destinos FTP/SFTP/S3 salvos pra onde um backup de banco pode ser enviado —
 * mesmo padrão visual/de uso de GitAccountsCard: listar, adicionar, remover.
 * Sem edição — pra trocar, remove e cadastra de novo (senha/secret key nunca
 * volta em claro, então não daria pra pré-preencher um formulário de edição mesmo).
 */
export function BackupDestinationsCard() {
  const [destinations, setDestinations] = useState<BackupDestinationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<BackupDestinationSummary | null>(null);

  const [label, setLabel] = useState('');
  const [protocol, setProtocol] = useState<'sftp' | 'ftp' | 's3'>('sftp');
  const [host, setHost] = useState('');
  const [port, setPort] = useState(22);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remotePath, setRemotePath] = useState('/');
  const [bucket, setBucket] = useState('');
  const [region, setRegion] = useState('us-east-1');

  function load() {
    apiFetch<BackupDestinationSummary[]>('/backup-destinations')
      .then(setDestinations)
      .catch((e) => setError(e instanceof Error ? e.message : 'Falha ao carregar'));
  }

  useEffect(load, []);

  function resetForm() {
    setLabel('');
    setHost('');
    setUsername('');
    setPassword('');
    setRemotePath('/');
    setPort(protocol === 'sftp' ? 22 : 21);
    setBucket('');
    setRegion('us-east-1');
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body =
        protocol === 's3'
          ? { label: label.trim(), protocol, host: host.trim() || undefined, username: username.trim(), password, remotePath: remotePath.trim() || '/', bucket: bucket.trim(), region: region.trim() || 'us-east-1' }
          : { label: label.trim(), protocol, host: host.trim(), port, username: username.trim(), password, remotePath: remotePath.trim() || '/' };
      await apiFetch('/backup-destinations', { method: 'POST', body: JSON.stringify(body) });
      setAdding(false);
      resetForm();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar o destino');
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    if (!removing) return;
    setSaving(true);
    try {
      await apiFetch(`/backup-destinations/${removing.id}`, { method: 'DELETE' });
      setRemoving(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao remover');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card space-y-4 p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="section-title">Destinos de backup</p>
          <p className="text-xs text-slate-400">Servidores FTP/SFTP ou bucket S3 pra onde um backup de banco pode ser enviado</p>
        </div>
        {!adding && (
          <button onClick={() => setAdding(true)} className="btn-secondary flex items-center gap-1.5 px-3.5 py-2 text-sm">
            <IconPlus className="h-4 w-4" aria-hidden />
            Adicionar
          </button>
        )}
      </div>

      {error && <Alert variant="error">{error}</Alert>}

      {destinations === null && <p className="text-sm text-slate-400">Carregando...</p>}
      {destinations?.length === 0 && !adding && <p className="text-sm text-slate-400">Nenhum destino configurado ainda.</p>}

      {destinations && destinations.length > 0 && (
        <div className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
          {destinations.map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">{d.label}</p>
                <p className="truncate text-xs text-slate-400">
                  {d.protocol === 's3'
                    ? `S3 · ${d.bucket}${d.region ? ` (${d.region})` : ''}${d.remotePath && d.remotePath !== '/' ? ` · ${d.remotePath}` : ''}`
                    : `${d.protocol.toUpperCase()} · ${d.username}@${d.host}:${d.port}${d.remotePath}`}
                </p>
              </div>
              <button
                onClick={() => setRemoving(d)}
                className="shrink-0 rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10"
                aria-label="Remover destino"
              >
                <IconTrash className="h-4 w-4" aria-hidden />
              </button>
            </div>
          ))}
        </div>
      )}

      {adding && (
        <form onSubmit={handleSave} className="space-y-3 rounded-lg border border-slate-200 p-3.5 dark:border-slate-700">
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-slate-700 dark:text-slate-200">Rótulo</span>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="ex.: Servidor de backup" className="input" required />
          </label>

          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-slate-700 dark:text-slate-200">Protocolo</span>
            <select
              value={protocol}
              onChange={(e) => {
                const next = e.target.value as 'sftp' | 'ftp' | 's3';
                setProtocol(next);
                setPort(next === 'sftp' ? 22 : 21);
              }}
              className="input"
            >
              <option value="sftp">SFTP</option>
              <option value="ftp">FTP</option>
              <option value="s3">S3 (ou compatível)</option>
            </select>
          </label>

          {protocol === 's3' ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm">
                  <span className="mb-1.5 block font-medium text-slate-700 dark:text-slate-200">Bucket</span>
                  <input value={bucket} onChange={(e) => setBucket(e.target.value)} placeholder="meu-bucket" className="input" required />
                </label>
                <label className="block text-sm">
                  <span className="mb-1.5 block font-medium text-slate-700 dark:text-slate-200">Região</span>
                  <input value={region} onChange={(e) => setRegion(e.target.value)} placeholder="us-east-1" className="input" />
                </label>
              </div>

              <label className="block text-sm">
                <span className="mb-1.5 block font-medium text-slate-700 dark:text-slate-200">Endpoint customizado</span>
                <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="opcional — MinIO, R2, B2... (em branco usa a AWS)" className="input" />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm">
                  <span className="mb-1.5 block font-medium text-slate-700 dark:text-slate-200">Access key ID</span>
                  <input value={username} onChange={(e) => setUsername(e.target.value)} className="input" required />
                </label>
                <label className="block text-sm">
                  <span className="mb-1.5 block font-medium text-slate-700 dark:text-slate-200">Secret access key</span>
                  <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="input" required />
                </label>
              </div>

              <label className="block text-sm">
                <span className="mb-1.5 block font-medium text-slate-700 dark:text-slate-200">Prefixo (opcional)</span>
                <input value={remotePath} onChange={(e) => setRemotePath(e.target.value)} placeholder="/" className="input" />
              </label>
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm">
                  <span className="mb-1.5 block font-medium text-slate-700 dark:text-slate-200">Host</span>
                  <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="backup.seudominio.com" className="input" required />
                </label>
                <label className="block text-sm">
                  <span className="mb-1.5 block font-medium text-slate-700 dark:text-slate-200">Porta</span>
                  <input type="number" value={port} onChange={(e) => setPort(Number(e.target.value))} className="input" required />
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm">
                  <span className="mb-1.5 block font-medium text-slate-700 dark:text-slate-200">Usuário</span>
                  <input value={username} onChange={(e) => setUsername(e.target.value)} className="input" required />
                </label>
                <label className="block text-sm">
                  <span className="mb-1.5 block font-medium text-slate-700 dark:text-slate-200">Senha</span>
                  <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="input" required />
                </label>
              </div>

              <label className="block text-sm">
                <span className="mb-1.5 block font-medium text-slate-700 dark:text-slate-200">Diretório remoto</span>
                <input value={remotePath} onChange={(e) => setRemotePath(e.target.value)} placeholder="/" className="input" />
              </label>
            </>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                resetForm();
              }}
              className="btn-secondary px-3.5 py-2 text-sm"
            >
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="btn-primary px-3.5 py-2 text-sm disabled:opacity-50">
              {saving ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </form>
      )}

      {removing && (
        <ConfirmModal
          title="Remover destino"
          message={`Remover "${removing.label}"? Bancos configurados pra usar esse destino passam a fazer backup só localmente.`}
          confirmLabel="Remover"
          danger
          loading={saving}
          onConfirm={handleRemove}
          onCancel={() => setRemoving(null)}
        />
      )}
    </div>
  );
}
