'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { Alert } from './Alert';
import { ConfirmModal } from './Modal';
import { StatusBadge } from './StatusBadge';
import { IconPlus, IconTrash, IconBell, IconCheck } from './icons';

type ChannelType = 'discord' | 'telegram' | 'webhook';

interface AlertChannel {
  id: string;
  label: string;
  type: ChannelType;
  enabled: boolean;
  createdAt: string;
}

interface AlertDelivery {
  id: string;
  channelId: string;
  title: string;
  ok: boolean;
  error: string | null;
  sentAt: string;
}

const TYPE_LABEL: Record<ChannelType, string> = { discord: 'Discord', telegram: 'Telegram', webhook: 'Webhook' };

/**
 * Destinos de alerta — Discord, Telegram ou webhook genérico.
 *
 * O backend (checagem a cada 5 minutos: servidor fora do ar, disco acima de
 * 90%, aplicação em erro, backup sem sucesso há 2+ dias) já existia desde a
 * v1.8.0; esta tela é o que faltava para configurá-lo de fato.
 */
export function AlertsCard() {
  const [channels, setChannels] = useState<AlertChannel[] | null>(null);
  const [recent, setRecent] = useState<AlertDelivery[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; ok: boolean; error?: string } | null>(null);
  const [removing, setRemoving] = useState<AlertChannel | null>(null);

  const [type, setType] = useState<ChannelType>('discord');
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [botToken, setBotToken] = useState('');
  const [chatId, setChatId] = useState('');

  function load() {
    apiFetch<{ channels: AlertChannel[]; recent: AlertDelivery[] }>('/alerts/channels')
      .then((r) => {
        setChannels(r.channels);
        setRecent(r.recent);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Falha ao carregar'));
  }
  useEffect(load, []);

  function resetForm() {
    setLabel('');
    setUrl('');
    setBotToken('');
    setChatId('');
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const config = type === 'telegram' ? { botToken: botToken.trim(), chatId: chatId.trim() } : { url: url.trim() };
      await apiFetch('/alerts/channels', { method: 'POST', body: JSON.stringify({ label: label.trim(), type, config }) });
      setAdding(false);
      resetForm();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao adicionar destino');
    } finally {
      setSaving(false);
    }
  }

  async function handleTest(channel: AlertChannel) {
    setTesting(channel.id);
    setTestResult(null);
    try {
      await apiFetch(`/alerts/channels/${channel.id}/test`, { method: 'POST' });
      setTestResult({ id: channel.id, ok: true });
    } catch (err) {
      setTestResult({ id: channel.id, ok: false, error: err instanceof Error ? err.message : 'Falha no envio' });
    } finally {
      setTesting(null);
      load();
    }
  }

  async function handleRemove() {
    if (!removing) return;
    try {
      await apiFetch(`/alerts/channels/${removing.id}`, { method: 'DELETE' });
      setRemoving(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao remover');
      setRemoving(null);
    }
  }

  // 403 é o caso normal pra quem não é admin.
  if (error?.includes('permissão') || error?.includes('administradores')) return null;

  return (
    <section className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="section-title">Alertas</h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Avisa quando um servidor cai, o disco passa de 90%, uma aplicação entra em erro, ou o backup fica 2 dias sem sucesso.
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
        <form onSubmit={handleCreate} className="mt-4 space-y-3 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Nome</span>
              <input required value={label} onChange={(e) => setLabel(e.target.value)} className="input" placeholder="Meu Discord" />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Tipo</span>
              <select value={type} onChange={(e) => setType(e.target.value as ChannelType)} className="input">
                <option value="discord">Discord</option>
                <option value="telegram">Telegram</option>
                <option value="webhook">Webhook genérico</option>
              </select>
            </label>
          </div>

          {type === 'telegram' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="mb-1 block font-medium">Token do bot</span>
                <input required value={botToken} onChange={(e) => setBotToken(e.target.value)} className="input" placeholder="123456:ABC-..." />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium">Chat ID</span>
                <input required value={chatId} onChange={(e) => setChatId(e.target.value)} className="input" placeholder="-100123456789" />
              </label>
            </div>
          ) : (
            <label className="block text-sm">
              <span className="mb-1 block font-medium">{type === 'discord' ? 'URL do webhook do Discord' : 'URL do webhook'}</span>
              <input required type="url" value={url} onChange={(e) => setUrl(e.target.value)} className="input" placeholder="https://..." />
              <span className="mt-1 block text-[11px] text-slate-400">Só https — em http o conteúdo do alerta viajaria em texto puro.</span>
            </label>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                resetForm();
              }}
              className="rounded-lg px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="btn-primary px-3 py-1.5 text-xs">
              {saving ? 'Salvando...' : 'Salvar destino'}
            </button>
          </div>
        </form>
      )}

      {channels && channels.length > 0 && (
        <div className="mt-4 divide-y divide-slate-200 dark:divide-slate-700">
          {channels.map((c) => (
            <div key={c.id} className="flex items-center gap-3 py-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                <IconBell className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{c.label}</p>
                <p className="truncate text-xs text-slate-400">{TYPE_LABEL[c.type]}</p>
              </div>
              {testResult?.id === c.id && (
                <span className={`text-xs ${testResult.ok ? 'text-green-500' : 'text-red-500'}`}>
                  {testResult.ok ? <IconCheck className="inline h-3.5 w-3.5" /> : (testResult.error ?? 'falhou')}
                </span>
              )}
              <button onClick={() => handleTest(c)} disabled={testing === c.id} className="btn-secondary shrink-0 px-2.5 py-1.5 text-xs">
                {testing === c.id ? 'Enviando...' : 'Testar'}
              </button>
              <button
                onClick={() => setRemoving(c)}
                aria-label={`Remover ${c.label}`}
                className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-red-500/10 hover:text-red-500"
              >
                <IconTrash className="h-4 w-4" aria-hidden />
              </button>
            </div>
          ))}
        </div>
      )}

      {channels && channels.length === 0 && !adding && (
        <p className="mt-3 text-sm text-slate-400">Nenhum destino configurado — os alertas não têm para onde ir ainda.</p>
      )}

      {recent.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-xs text-slate-500">Últimos envios ({recent.length})</summary>
          <div className="mt-2 space-y-1">
            {recent.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate text-slate-400">
                  {new Date(d.sentAt).toLocaleString('pt-BR')} · {d.title}
                </span>
                <StatusBadge tone={d.ok ? 'success' : 'danger'}>{d.ok ? 'enviado' : 'falhou'}</StatusBadge>
              </div>
            ))}
          </div>
        </details>
      )}

      {removing && (
        <ConfirmModal
          title="Remover destino"
          message={`Remover "${removing.label}"? Ele para de receber alertas na hora.`}
          confirmLabel="Remover"
          danger
          onConfirm={handleRemove}
          onCancel={() => setRemoving(null)}
        />
      )}
    </section>
  );
}
