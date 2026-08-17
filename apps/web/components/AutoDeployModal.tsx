'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { Alert } from './Alert';
import { Modal } from './Modal';
import { Skeleton } from './Skeleton';
import { IconCopy, IconCheck } from './icons';

interface AutoDeployState {
  enabled: boolean;
  gitRef: string | null;
  webhookUrl: string | null;
  autoCreated: boolean;
  /** Só vem preenchido na resposta de ligar o autodeploy — motivo de a
   * criação automática do webhook no GitHub não ter rolado (ver
   * GitDeployService.tryCreateGitHubWebhook). */
  warning?: string | null;
}

interface GitAccount {
  id: string;
  label: string;
  authMethod: string;
}

/**
 * Autodeploy: a forja avisa, o Velix reconstrói.
 *
 * A URL do webhook carrega o segredo que autentica a chamada, então ela só
 * aparece aqui, para um usuário já autenticado — nunca na listagem geral de
 * aplicações, que é carregada em tela aberta.
 */
export function AutoDeployModal({
  applicationId,
  deploymentId,
  appName,
  onClose,
}: {
  applicationId: string;
  deploymentId: string;
  appName: string;
  onClose: () => void;
}) {
  const [state, setState] = useState<AutoDeployState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [accounts, setAccounts] = useState<GitAccount[] | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [linking, setLinking] = useState(false);

  useEffect(() => {
    apiFetch<AutoDeployState>(`/applications/${applicationId}/deployments/${deploymentId}/auto-deploy`)
      .then(setState)
      .catch((e) => setError(e instanceof Error ? e.message : 'Falha ao carregar'));
  }, [applicationId, deploymentId]);

  // Só busca as contas salvas quando realmente pode precisar oferecer a opção
  // de associar uma — não vale o request extra quando já deu tudo certo.
  useEffect(() => {
    if (state?.enabled && !state.autoCreated && state.warning && accounts === null) {
      apiFetch<GitAccount[]>('/git-accounts')
        .then(setAccounts)
        .catch(() => {});
    }
  }, [state, accounts]);

  async function linkAccount() {
    if (!selectedAccountId) return;
    setLinking(true);
    setError(null);
    try {
      setState(
        await apiFetch<AutoDeployState>(`/applications/${applicationId}/deployments/${deploymentId}/git-account`, {
          method: 'PATCH',
          body: JSON.stringify({ gitAccountId: selectedAccountId }),
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao associar conta');
    } finally {
      setLinking(false);
    }
  }

  async function toggle(enabled: boolean) {
    setSaving(true);
    setError(null);
    try {
      setState(
        await apiFetch<AutoDeployState>(`/applications/${applicationId}/deployments/${deploymentId}/auto-deploy`, {
          method: 'PATCH',
          body: JSON.stringify({ enabled }),
        }),
      );
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

  // O GitHub nunca alcança um host privado — se WEB_ORIGIN ficou configurado
  // errado (IP interno, "localhost", detecção de IP público que falhou na
  // instalação), a URL é montada normalmente e parece válida, mas o webhook
  // nunca vai chegar. Isso não aparece em lugar nenhum hoje — só descobre
  // quem souber ir checar "Recent Deliveries" no GitHub.
  const unreachableHost = (() => {
    if (!state?.webhookUrl) return false;
    try {
      const host = new URL(state.webhookUrl).hostname;
      return host === 'localhost' || host === '127.0.0.1' || /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(host);
    } catch {
      return false;
    }
  })();

  return (
    <Modal title={`Autodeploy — ${appName}`} onClose={onClose} maxWidth="max-w-lg">
      {!state ? (
        <Skeleton className="h-32" />
      ) : (
        <div className="space-y-4">
          <label className="flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={state.enabled}
              disabled={saving}
              onChange={(e) => toggle(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium text-slate-800 dark:text-slate-100">Reimplantar a cada push</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">
                Só pushes na branch <code>{state.gitRef ?? 'main'}</code> disparam a reconstrução. Push em outra branch é
                ignorado, para não reimplantar trabalho em andamento.
              </span>
            </span>
          </label>

          {state.enabled && state.autoCreated && (
            <Alert variant="success">
              Webhook criado automaticamente no repositório — não precisa colar nada no GitHub, já está funcionando.
            </Alert>
          )}

          {state.enabled && state.warning && !state.autoCreated && (
            <Alert variant="warning">
              Não consegui criar o webhook automaticamente no GitHub: {state.warning}. Cole a URL abaixo manualmente.
            </Alert>
          )}

          {state.enabled && state.warning && !state.autoCreated && accounts && accounts.length > 0 && (
            <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <p className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                Ou associa uma conta salva e tenta de novo automaticamente:
              </p>
              <div className="flex gap-2">
                <select
                  value={selectedAccountId}
                  onChange={(e) => setSelectedAccountId(e.target.value)}
                  className="input flex-1 text-sm"
                >
                  <option value="">Escolha uma conta...</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label} {a.authMethod === 'github_app' ? '(Conectar com GitHub)' : '(token)'}
                    </option>
                  ))}
                </select>
                <button
                  onClick={linkAccount}
                  disabled={!selectedAccountId || linking}
                  className="btn-secondary shrink-0 px-3 py-1.5 text-xs"
                >
                  {linking ? 'Associando...' : 'Associar'}
                </button>
              </div>
            </div>
          )}

          {state.enabled && state.webhookUrl && !state.autoCreated && (
            <div>
              <p className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                Cole esta URL no repositório, em Settings → Webhooks → Add webhook, com tipo de conteúdo{' '}
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
                reimplantações desta aplicação (e só desta).
              </p>
              {unreachableHost && (
                <div className="mt-2">
                  <Alert variant="warning">
                    Esse endereço ({new URL(state!.webhookUrl!).hostname}) é interno — o GitHub não consegue alcançá-lo
                    de fora. Corrija o <code>WEB_ORIGIN</code> nas configurações do servidor pro domínio ou IP público
                    real do painel antes de colar essa URL no GitHub.
                  </Alert>
                </div>
              )}
            </div>
          )}

          {state.enabled && !state.webhookUrl && (
            <Alert variant="warning">
              O endereço público do painel não está configurado (WEB_ORIGIN), então não dá para montar a URL do webhook.
            </Alert>
          )}

          {error && <Alert variant="error">{error}</Alert>}

          <div className="flex justify-end">
            <button onClick={onClose} className="btn-secondary px-4 py-2 text-sm">
              Fechar
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
