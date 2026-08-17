'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { Alert } from './Alert';
import { IconCopy, IconCheck } from './icons';

interface WebhookState {
  enabled: boolean;
  gitRef: string;
  webhookUrl: string | null;
}

/**
 * Autoatualização por push — sem esperar uma release publicada, qualquer
 * push na branch configurada já dispara o mesmo processo do botão
 * "Atualizar" acima (ver SelfUpdateService/PlatformWebhookService).
 *
 * Mesmo padrão visual do AutoDeployModal (autodeploy de aplicações), mas
 * como card fixo em vez de modal — aqui só existe uma configuração (a do
 * próprio Velix), não uma por aplicação.
 */
export function PlatformWebhookCard() {
  const [state, setState] = useState<WebhookState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    apiFetch<WebhookState>('/updates/webhook')
      .then(setState)
      .catch((e) => setError(e instanceof Error ? e.message : 'Falha ao carregar'));
  }, []);

  async function toggle(enabled: boolean) {
    setSaving(true);
    setError(null);
    try {
      setState(await apiFetch<WebhookState>('/updates/webhook', { method: 'PATCH', body: JSON.stringify({ enabled }) }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar');
    } finally {
      setSaving(false);
    }
  }

  async function copy() {
    if (!state?.webhookUrl) return;
    await navigator.clipboard.writeText(state.webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!state) return null;

  return (
    <section className="card p-5">
      <label className="flex items-start gap-2.5 text-sm">
        <input
          type="checkbox"
          checked={state.enabled}
          disabled={saving}
          onChange={(e) => toggle(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          <span className="font-medium text-slate-800 dark:text-slate-100">Atualizar a cada push</span>
          <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">
            Sem esperar uma release publicada: qualquer push na branch <code>{state.gitRef}</code> do repositório do
            Velix dispara o mesmo processo do botão &quot;Atualizar&quot; acima.
          </span>
        </span>
      </label>

      {error && (
        <div className="mt-3">
          <Alert variant="error">{error}</Alert>
        </div>
      )}

      {state.enabled && state.webhookUrl && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">
            Cole esta URL no repositório do Velix, em Settings → Webhooks → Add webhook, com tipo de conteúdo{' '}
            <code>application/json</code>:
          </p>
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-900/60">
            <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-[12px] text-slate-700 dark:text-slate-200">
              {state.webhookUrl}
            </code>
            <button
              onClick={copy}
              aria-label="Copiar URL do webhook"
              className="shrink-0 rounded-md p-1.5 text-slate-400 transition hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-100"
            >
              {copied ? <IconCheck className="h-4 w-4 text-green-500" aria-hidden /> : <IconCopy className="h-4 w-4" aria-hidden />}
            </button>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
            A URL contém um segredo que autentica a chamada — trate como senha. Quem a tiver pode disparar
            atualizações neste servidor.
          </p>
        </div>
      )}

      {state.enabled && !state.webhookUrl && (
        <div className="mt-3">
          <Alert variant="warning">
            O endereço público do painel não está configurado (WEB_ORIGIN), então não dá para montar a URL do
            webhook.
          </Alert>
        </div>
      )}
    </section>
  );
}
