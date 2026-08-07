'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { Alert } from './Alert';
import { NetworkPulse } from './NetworkPulse';
import { OpsLogPanel, type OpsLogStatus } from './InstallLogModal';
import { TerminalWindow } from './TerminalChrome';
import { IconCheck, IconX, IconTerminal, IconServer } from './icons';

type Step = 'form' | 'testing' | 'prepare' | 'installing';

interface Props {
  onClose: () => void;
  onSaved: () => void;
}

const ACME_INVALID_TLDS = new Set(['local', 'localhost', 'test', 'invalid', 'example', 'internal', 'lan', 'home', 'arpa']);

function isValidAcmeEmail(email: string) {
  const trimmed = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return false;
  return !ACME_INVALID_TLDS.has(trimmed.split('.').pop() ?? '');
}

const INSTALL_PHRASES = [
  'Instalando o Docker Engine no servidor...',
  'Isso costuma levar de 2 a 5 minutos na primeira vez.',
  'Baixando pacotes e configurando o serviço.',
  'Quase lá — conferindo se o Docker subiu corretamente.',
];

/**
 * Cadastrar um servidor e prepará-lo eram duas coisas soltas: o formulário
 * salvava e pronto, e descobrir que a credencial estava errada só acontecia
 * depois, na lista, com um status "erro" sem contexto. E instalar o Docker
 * exigia achar a aba certa dentro do servidor.
 *
 * O fluxo agora encadeia as três etapas — dados, conexão, preparação — porque é
 * a ordem em que elas realmente dependem uma da outra: sem SSH válido não há
 * como instalar nada, e sem Docker não há como implantar aplicação nenhuma.
 */
export function AddServerWizard({ onClose, onSaved }: Props) {
  const [step, setStep] = useState<Step>('form');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [serverId, setServerId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; message?: string; osName?: string | null } | null>(null);

  const [wantsTraefik, setWantsTraefik] = useState(false);
  const [acmeEmail, setAcmeEmail] = useState('');
  const [installStatus, setInstallStatus] = useState<OpsLogStatus>('connecting');
  const [showLog, setShowLog] = useState(false);
  const [phrase, setPhrase] = useState(0);

  const [form, setForm] = useState({
    name: '',
    publicIp: '',
    sshPort: 22,
    sshUser: 'root',
    authMethod: 'PASSWORD' as 'PASSWORD' | 'PRIVATE_KEY',
    password: '',
    privateKey: '',
  });

  useEffect(() => {
    if (step !== 'installing' || installStatus === 'done-ok' || installStatus === 'done-error') return;
    const timer = setInterval(() => setPhrase((i) => (i + 1) % INSTALL_PHRASES.length), 6000);
    return () => clearInterval(timer);
  }, [step, installStatus]);

  /** Salva e testa em sequência: o teste é o que dá sentido à etapa seguinte. */
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const created = await apiFetch<{ id: string }>('/servers', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      setServerId(created.id);
      setStep('testing');

      const result = await apiFetch<{ ok: boolean; message?: string; osName?: string | null }>(
        `/servers/${created.id}/test-connection`,
        { method: 'POST' },
      );
      setTestResult(result);
      if (result.ok) setStep('prepare');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao cadastrar o servidor');
      setStep('form');
    } finally {
      setSaving(false);
    }
  }

  async function retryTest() {
    if (!serverId) return;
    setStep('testing');
    setTestResult(null);
    try {
      const result = await apiFetch<{ ok: boolean; message?: string; osName?: string | null }>(
        `/servers/${serverId}/test-connection`,
        { method: 'POST' },
      );
      setTestResult(result);
      if (result.ok) setStep('prepare');
    } catch (err) {
      setTestResult({ ok: false, message: err instanceof Error ? err.message : 'Falha na conexão' });
    }
  }

  const installDone = installStatus === 'done-ok';
  const installFailed = installStatus === 'done-error';
  // Fechar no meio da instalação deixaria o processo rodando sem tela; o
  // servidor já está cadastrado de qualquer forma, então onSaved é seguro.
  const closable = step !== 'installing' || installDone || installFailed;

  return (
    <div className="overlay-fade fixed inset-0 z-30 flex items-center justify-center overflow-y-auto bg-slate-950/50 p-4 backdrop-blur-md">
      <div className="modal-pop card flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-700">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Adicionar servidor</h2>
            <p className="text-xs text-slate-400">
              {step === 'form' && 'Dados de acesso'}
              {step === 'testing' && 'Testando conexão'}
              {step === 'prepare' && 'Preparar o servidor'}
              {step === 'installing' && (installDone ? 'Pronto' : 'Instalando')}
            </p>
          </div>
          {closable && (
            <button onClick={onClose} aria-label="Fechar" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
              <IconX className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {step === 'form' && (
            <form id="add-server-form" onSubmit={handleSubmit}>
              <Field label="Nome">
                <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input" placeholder="web-01" />
              </Field>
              <Field label="IP público">
                <input required value={form.publicIp} onChange={(e) => setForm({ ...form, publicIp: e.target.value })} className="input" placeholder="203.0.113.10" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Porta SSH">
                  <input type="number" value={form.sshPort} onChange={(e) => setForm({ ...form, sshPort: Number(e.target.value) })} className="input" />
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
                <Field label="Senha">
                  <input type="password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="input" />
                </Field>
              ) : (
                <Field label="Chave privada">
                  <textarea
                    required
                    rows={4}
                    value={form.privateKey}
                    onChange={(e) => setForm({ ...form, privateKey: e.target.value })}
                    className="input font-mono text-xs"
                    placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                  />
                </Field>
              )}
              {error && (
                <div className="mt-3">
                  <Alert variant="error">{error}</Alert>
                </div>
              )}
            </form>
          )}

          {step === 'testing' && (
            <div className="flex flex-col items-center py-8 text-center">
              <NetworkPulse state="running" label="?" className="h-28 w-28" ariaLabel="Testando conexão" />
              <h3 className="mt-4 text-base font-semibold text-slate-900 dark:text-slate-50">Testando a conexão SSH</h3>
              <p className="mt-1 text-xs text-slate-500">
                Conectando em {form.sshUser}@{form.publicIp}:{form.sshPort}
              </p>
            </div>
          )}

          {step === 'prepare' && testResult && (
            <div>
              <div className="flex flex-col items-center pb-5 text-center">
                <NetworkPulse state={testResult.ok ? 'success' : 'error'} className="h-24 w-24" ariaLabel="Resultado do teste" />
                <h3 className="mt-3 text-base font-semibold text-slate-900 dark:text-slate-50">
                  {testResult.ok ? 'Conexão estabelecida' : 'Não foi possível conectar'}
                </h3>
                <p className="mt-1 max-w-sm text-xs text-slate-500">
                  {testResult.ok
                    ? `${testResult.osName ? `${testResult.osName} · ` : ''}O servidor está cadastrado. Falta preparar para receber aplicações.`
                    : testResult.message}
                </p>
              </div>

              {testResult.ok ? (
                <div className="space-y-3 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                  <div className="flex items-start gap-2.5">
                    <IconServer className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" aria-hidden />
                    <div>
                      <p className="text-sm font-medium text-slate-800 dark:text-slate-100">Instalar o Velix no servidor</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
                        Instala o Docker Engine, sem o qual nenhuma aplicação pode ser implantada. Se o Docker já existir,
                        a etapa é pulada.
                      </p>
                    </div>
                  </div>

                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={wantsTraefik}
                      onChange={(e) => setWantsTraefik(e.target.checked)}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="font-medium text-slate-700 dark:text-slate-200">Instalar também o Traefik</span>
                      <span className="mt-0.5 block text-xs text-slate-500">
                        Necessário para publicar aplicações com domínio e HTTPS. Ocupa as portas 80 e 443.
                      </span>
                    </span>
                  </label>

                  {wantsTraefik && (
                    <label className="block text-sm">
                      <span className="mb-1.5 block font-medium text-slate-700 dark:text-slate-200">E-mail (Let&apos;s Encrypt)</span>
                      <input type="email" value={acmeEmail} onChange={(e) => setAcmeEmail(e.target.value)} className="input" placeholder="voce@seudominio.com" />
                    </label>
                  )}
                </div>
              ) : (
                <Alert variant="warning">
                  O servidor foi cadastrado, mas o Velix não conseguiu se conectar. Confira usuário, porta e credencial —
                  você pode corrigir depois em Editar servidor.
                </Alert>
              )}
            </div>
          )}

          {step === 'installing' && serverId && (
            <div className="flex flex-col items-center py-4 text-center">
              <NetworkPulse
                state={installFailed ? 'error' : installDone ? 'success' : 'running'}
                label={form.name.charAt(0).toUpperCase() || 'S'}
                className="h-28 w-28"
                ariaLabel="Instalando"
              />
              <h3 className="mt-4 text-base font-semibold text-slate-900 dark:text-slate-50">
                {installFailed ? 'A instalação falhou' : installDone ? `${form.name} está pronto` : `Instalando o Velix em ${form.name}`}
              </h3>
              <p className="mt-1.5 flex min-h-[2.5rem] max-w-sm items-center justify-center text-xs text-slate-500">
                {installFailed
                  ? 'Veja o log abaixo. O servidor continua cadastrado e você pode tentar de novo pela aba Docker.'
                  : installDone
                    ? 'Já dá para implantar aplicações neste servidor.'
                    : INSTALL_PHRASES[phrase]}
              </p>

              <button
                onClick={() => setShowLog((v) => !v)}
                className="mt-4 flex items-center gap-1.5 text-xs text-slate-400 transition hover:text-slate-600 dark:hover:text-slate-200"
              >
                <IconTerminal className="h-3.5 w-3.5" aria-hidden />
                {showLog ? 'Ocultar log' : 'Ver log'}
              </button>

              {/* Sempre montado: é ele que conduz a operação pelo WebSocket. */}
              <div className={`mt-3 w-full ${showLog ? '' : 'sr-only'}`}>
                <TerminalWindow title="Instalação" bodyClassName="flex h-[32vh] p-3">
                  <OpsLogPanel
                    serverId={serverId}
                    op={wantsTraefik ? 'server-prepare' : 'docker-install'}
                    params={wantsTraefik ? { acmeEmail: acmeEmail.trim() } : undefined}
                    onStatusChange={setInstallStatus}
                    onDone={() => {}}
                  />
                </TerminalWindow>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3.5 dark:border-slate-700">
          {step === 'form' && (
            <>
              <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
                Cancelar
              </button>
              <button type="submit" form="add-server-form" disabled={saving} className="btn-primary px-4 py-2 text-sm">
                {saving ? 'Salvando...' : 'Salvar e testar conexão'}
              </button>
            </>
          )}

          {step === 'prepare' && testResult && (
            <>
              <button onClick={onSaved} className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
                {testResult.ok ? 'Pular por enquanto' : 'Fechar'}
              </button>
              {testResult.ok ? (
                <button
                  onClick={() => setStep('installing')}
                  disabled={wantsTraefik && !isValidAcmeEmail(acmeEmail)}
                  className="btn-primary px-4 py-2 text-sm disabled:opacity-50"
                >
                  Instalar Velix
                </button>
              ) : (
                <button onClick={retryTest} className="btn-primary px-4 py-2 text-sm">
                  Testar novamente
                </button>
              )}
            </>
          )}

          {step === 'installing' && (installDone || installFailed) && (
            <button onClick={onSaved} className="btn-primary flex items-center gap-1.5 px-4 py-2 text-sm">
              {installDone && <IconCheck className="h-4 w-4" aria-hidden />}
              Concluir
            </button>
          )}
        </div>
      </div>
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
