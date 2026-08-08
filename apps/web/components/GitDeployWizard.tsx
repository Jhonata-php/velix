'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/api';
import type { ServerSummary } from '@/lib/types';
import { Alert } from './Alert';
import { DeployProgress, type ProgressStage } from './DeployProgress';
import { OpsLogPanel } from './InstallLogModal';
import { TerminalWindow } from './TerminalChrome';
import { IconX, IconGithub, IconServer, IconCheck, IconRefresh } from './icons';

type StepKey = 'repo' | 'build' | 'server' | 'config' | 'deploy';

const ALL_STEPS: { key: StepKey; label: string }[] = [
  { key: 'repo', label: 'Repositório' },
  { key: 'build', label: 'Build' },
  { key: 'server', label: 'Servidor' },
  { key: 'config', label: 'Configuração' },
  { key: 'deploy', label: 'Implantação' },
];

const HOSTNAME_PATTERN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;
const ALLOWED_HOSTS = ['github.com', 'gitlab.com', 'bitbucket.org', 'codeberg.org'];

/** Espelha validateRepoUrl do backend — o servidor revalida de qualquer forma;
 * aqui é só pra não deixar o usuário chegar até a implantação com erro óbvio. */
function repoUrlValid(raw: string) {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'https:') return false;
    if (!ALLOWED_HOSTS.includes(url.hostname)) return false;
    if (url.username || url.password) return false;
    const path = url.pathname.replace(/\.git$/, '').replace(/^\/+|\/+$/g, '');
    return /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(path);
  } catch {
    return false;
  }
}

function repoName(raw: string) {
  try {
    return new URL(raw.trim()).pathname.replace(/\.git$/, '').split('/').filter(Boolean).pop() ?? '';
  } catch {
    return '';
  }
}

/** Rótulo curto e legível pra sugestão de domínio aleatório — não precisa ser
 * criptograficamente forte, só improvável de colidir com outro subdomínio já
 * usado na mesma zona. */
function randomDomainLabel(base: string): string {
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'app'}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Etapas reconhecidas na saída real do processo — ver DeployProgress. */
const GIT_STAGES: ProgressStage[] = [
  { label: 'Preparando o diretório', match: /Preparando/i },
  { label: 'Clonando o repositório', match: /Clonando|Cloning|remote:/i },
  { label: 'Construindo a imagem', match: /Construindo|Instalando o Nixpacks|Step \d|--->|naming to|writing image/i },
  { label: 'Subindo o container', match: /Gravando docker-compose|Garantindo rede|Subindo|Creating|Started/i },
  { label: 'Verificando', match: /Aguardando|Associando dom/i },
];

interface GitAccount {
  id: string;
  label: string;
  host: string;
  authMethod: string;
  tokenHint: string | null;
}

interface GitHubRepoOption {
  fullName: string;
  private: boolean;
  defaultBranch: string;
}

interface Props {
  /** Quando informado, o serviço entra NESTE projeto já existente — pula a
   * etapa "Servidor" (já é o do projeto, fixo). Sem isso, cria um projeto
   * novo automaticamente com o nome digitado na etapa "Configuração". */
  applicationId?: string;
  projectServerId?: string;
  onClose: () => void;
  onDeployed: () => void;
}

/**
 * Implantar código do usuário, em vez de um app do catálogo.
 *
 * O token de repositório privado é enviado uma vez e guardado cifrado no
 * servidor; ele nunca volta em nenhuma resposta da API, então não há como
 * exibi-lo de volta aqui — por isso o campo fica vazio ao reeditar.
 */
export function GitDeployWizard({ applicationId, projectServerId, onClose, onDeployed }: Props) {
  const visibleSteps = useMemo(() => (applicationId ? ALL_STEPS.filter((s) => s.key !== 'server') : ALL_STEPS), [applicationId]);
  const [step, setStep] = useState(0);
  const currentKey = visibleSteps[step]?.key;

  const [repoUrl, setRepoUrl] = useState('');
  const [gitRef, setGitRef] = useState('main');
  const [token, setToken] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [accounts, setAccounts] = useState<GitAccount[]>([]);
  const [gitAccountId, setGitAccountId] = useState('');
  const [autoDeploy, setAutoDeploy] = useState(true);

  // Contas conectadas via "Conectar com GitHub" conseguem listar os próprios
  // repositórios — troca "cole a URL" por "escolha da lista", só pra elas.
  const githubAppAccounts = useMemo(() => accounts.filter((a) => a.authMethod === 'github_app'), [accounts]);
  const [pickerMode, setPickerMode] = useState<'list' | 'manual'>('manual');
  const [repos, setRepos] = useState<GitHubRepoOption[] | null>(null);
  const [reposError, setReposError] = useState<string | null>(null);
  const [selectedRepo, setSelectedRepo] = useState('');
  const [branches, setBranches] = useState<string[] | null>(null);

  useEffect(() => {
    if (githubAppAccounts.length > 0 && pickerMode === 'manual' && !repoUrl.trim()) setPickerMode('list');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [githubAppAccounts.length]);

  // No modo lista, a conta selecionada precisa ser uma conta GitHub App —
  // o fetch inicial de /git-accounts pode ter marcado uma conta de token
  // como padrão (a primeira da lista, seja lá qual for).
  useEffect(() => {
    if (pickerMode !== 'list' || githubAppAccounts.length === 0) return;
    if (!githubAppAccounts.some((a) => a.id === gitAccountId)) setGitAccountId(githubAppAccounts[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickerMode, githubAppAccounts]);

  useEffect(() => {
    if (pickerMode !== 'list' || !gitAccountId) return;
    setRepos(null);
    setReposError(null);
    setSelectedRepo('');
    apiFetch<GitHubRepoOption[]>(`/git-accounts/${gitAccountId}/repos`)
      .then(setRepos)
      .catch((e) => setReposError(e instanceof Error ? e.message : 'Falha ao listar repositórios'));
  }, [pickerMode, gitAccountId]);

  useEffect(() => {
    if (pickerMode !== 'list' || !selectedRepo) return;
    const repo = repos?.find((r) => r.fullName === selectedRepo);
    const [owner, name] = selectedRepo.split('/');
    setRepoUrl(`https://github.com/${selectedRepo}.git`);
    if (repo) setGitRef(repo.defaultBranch);
    setBranches(null);
    apiFetch<string[]>(`/git-accounts/${gitAccountId}/repos/${owner}/${name}/branches`)
      .then(setBranches)
      .catch(() => setBranches(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickerMode, selectedRepo]);

  const [buildMethod, setBuildMethod] = useState<'dockerfile' | 'nixpacks'>('dockerfile');
  const [dockerfilePath, setDockerfilePath] = useState('Dockerfile');

  const [servers, setServers] = useState<ServerSummary[] | null>(null);
  const [serverId, setServerId] = useState(projectServerId ?? '');

  const [name, setName] = useState('');
  const [port, setPort] = useState(3000);
  const [envText, setEnvText] = useState('');
  const [wantsDomain, setWantsDomain] = useState(false);
  const [hostname, setHostname] = useState('');
  const [zones, setZones] = useState<{ id: string; name: string }[]>([]);

  const [showLog, setShowLog] = useState(false);
  const [lastLine, setLastLine] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [resolvedAppId, setResolvedAppId] = useState<string | null>(applicationId ?? null);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<GitAccount[]>('/git-accounts')
      .then((list) => {
        setAccounts(list);
        if (list.length > 0) setGitAccountId(list[0].id);
      })
      .catch(() => {});
    apiFetch<ServerSummary[]>('/servers').then((list) => {
      setServers(list);
      if (!projectServerId) {
        const recommended = list.find((s) => s.dockerInstalled);
        if (recommended) setServerId(recommended.id);
      }
    });
    // Sem conta Cloudflare conectada, a API devolve 404 — sem problema, só
    // significa que o botão de gerar domínio aleatório fica escondido.
    apiFetch<{ id: string; name: string }[]>('/cloudflare/zones')
      .then(setZones)
      .catch(() => {});
  }, [projectServerId]);

  // Nome sugerido a partir do repositório, mas só enquanto o usuário não digitou
  // o dele — sobrescrever o que ele escreveu seria pior que não sugerir nada.
  const [nameTouched, setNameTouched] = useState(false);
  useEffect(() => {
    if (!nameTouched) setName(repoName(repoUrl));
  }, [repoUrl, nameTouched]);

  const selectedServer = servers?.find((s) => s.id === serverId) ?? null;

  const env = Object.fromEntries(
    envText
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => {
        const i = l.indexOf('=');
        return i === -1 ? [l, ''] : [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      })
      .filter(([k]) => k),
  );

  const usingAccountForClone = pickerMode === 'list' || isPrivate;

  const validByKey: Record<StepKey, boolean> = {
    repo:
      repoUrlValid(repoUrl) &&
      gitRef.trim().length > 0 &&
      (pickerMode === 'list' ? !!selectedRepo : !isPrivate || !!gitAccountId || token.trim().length > 0),
    build: buildMethod === 'nixpacks' || dockerfilePath.trim().length > 0,
    server: !!selectedServer?.dockerInstalled,
    config: name.trim().length >= 2 && port > 0 && port <= 65535 && (!wantsDomain || HOSTNAME_PATTERN.test(hostname.trim())),
    deploy: true,
  };
  const stepValid = visibleSteps.map((s) => validByKey[s.key]);

  const params = {
    repoUrl: repoUrl.trim(),
    gitRef: gitRef.trim(),
    buildMethod,
    ...(buildMethod === 'dockerfile' ? { dockerfilePath: dockerfilePath.trim() } : {}),
    ...(usingAccountForClone && gitAccountId ? { gitAccountId } : {}),
    ...(!usingAccountForClone && isPrivate && !gitAccountId && token.trim() ? { token: token.trim() } : {}),
    autoDeploy,
    port,
    env,
    ...(wantsDomain ? { domain: { hostname: hostname.trim(), createDnsRecord: true } } : {}),
  };

  // Sem `applicationId`: cria o projeto (nome desta etapa) antes de implantar
  // o serviço nele — mesmo padrão do DeployWizard do catálogo.
  useEffect(() => {
    if (applicationId || resolvedAppId || currentKey !== 'deploy') return;
    apiFetch<{ id: string }>('/applications', {
      method: 'POST',
      body: JSON.stringify({ serverId, name: name.trim() }),
    })
      .then((app) => setResolvedAppId(app.id))
      .catch((e) => setCreateError(e instanceof Error ? e.message : 'Falha ao criar o projeto'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentKey]);

  const running = currentKey === 'deploy' && !result;

  return (
    <div className="overlay-fade fixed inset-0 z-30 flex items-center justify-center overflow-y-auto bg-slate-950/50 p-4 backdrop-blur-md">
      <div className="modal-pop card flex max-h-[88vh] min-h-[480px] w-full max-w-3xl flex-col overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-700">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900">
              <IconGithub className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Implantar do repositório</h2>
              <p className="text-xs text-slate-400">
                Etapa {step + 1} de {visibleSteps.length} — {visibleSteps[step]?.label}
              </p>
            </div>
          </div>
          {!running && (
            <button onClick={onClose} aria-label="Fechar" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
              <IconX className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {currentKey === 'repo' && (
            <div className="mx-auto max-w-xl space-y-4">
              {githubAppAccounts.length > 0 && (
                <div className="flex gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800/60">
                  <button
                    onClick={() => setPickerMode('list')}
                    className={`tab-pill flex-1 ${pickerMode === 'list' ? 'tab-pill-active' : ''}`}
                  >
                    Escolher da lista
                  </button>
                  <button
                    onClick={() => setPickerMode('manual')}
                    className={`tab-pill flex-1 ${pickerMode === 'manual' ? 'tab-pill-active' : ''}`}
                  >
                    Colar URL manualmente
                  </button>
                </div>
              )}

              {pickerMode === 'list' && githubAppAccounts.length > 0 ? (
                <>
                  {githubAppAccounts.length > 1 && (
                    <Field label="Conta">
                      <select value={gitAccountId} onChange={(e) => setGitAccountId(e.target.value)} className="input">
                        {githubAppAccounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                  )}

                  <Field label="Repositório">
                    {reposError ? (
                      <Alert variant="error">{reposError}</Alert>
                    ) : repos === null ? (
                      <p className="text-sm text-slate-400">Carregando repositórios...</p>
                    ) : repos.length === 0 ? (
                      <p className="text-sm text-slate-400">
                        Nenhum repositório liberado pra essa conta — instale o App em mais repositórios em
                        github.com/settings/installations.
                      </p>
                    ) : (
                      <select value={selectedRepo} onChange={(e) => setSelectedRepo(e.target.value)} className="input">
                        <option value="">Selecione...</option>
                        {repos.map((r) => (
                          <option key={r.fullName} value={r.fullName}>
                            {r.fullName} {r.private ? '(privado)' : ''}
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>

                  {selectedRepo && (
                    <Field label="Branch, tag ou commit">
                      {branches === null ? (
                        <p className="text-sm text-slate-400">Carregando branches...</p>
                      ) : (
                        <select value={gitRef} onChange={(e) => setGitRef(e.target.value)} className="input">
                          {branches.map((b) => (
                            <option key={b} value={b}>
                              {b}
                            </option>
                          ))}
                        </select>
                      )}
                    </Field>
                  )}
                </>
              ) : (
                <>
                  <Field label="URL do repositório">
                    <input
                      value={repoUrl}
                      onChange={(e) => setRepoUrl(e.target.value)}
                      placeholder="https://github.com/usuario/projeto"
                      className="input"
                    />
                    <span className="mt-1 block text-[11px] text-slate-400">
                      Aceitos: {ALLOWED_HOSTS.join(', ')}. Só https — outros esquemas são recusados por segurança.
                    </span>
                  </Field>
                  {repoUrl.trim() && !repoUrlValid(repoUrl) && <Alert variant="error">URL inválida. Use o formato https://github.com/usuario/projeto</Alert>}

                  <Field label="Branch, tag ou commit">
                    <input value={gitRef} onChange={(e) => setGitRef(e.target.value)} placeholder="main" className="input" />
                  </Field>

                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
                    <span className="font-medium text-slate-700 dark:text-slate-200">O repositório é privado</span>
                  </label>

                  {isPrivate && (
                    <div className="space-y-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                      {accounts.length > 0 && (
                        <Field label="Conta">
                          <select value={gitAccountId} onChange={(e) => setGitAccountId(e.target.value)} className="input">
                            {accounts.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.label} ({a.host}
                                {a.authMethod === 'github_app' ? ' · App' : ` · ····${a.tokenHint}`})
                              </option>
                            ))}
                            <option value="">Usar outro token desta vez</option>
                          </select>
                        </Field>
                      )}

                      {(!accounts.length || !gitAccountId) && (
                        <Field label="Token de acesso">
                          <input type="password" value={token} onChange={(e) => setToken(e.target.value)} className="input" placeholder="ghp_..." />
                          <span className="mt-1 block text-[11px] text-slate-400">
                            Guardado cifrado no Velix e usado só para clonar. Nunca volta em nenhuma resposta da API e é
                            removido dos logs. Salve a conta em Configurações para reaproveitar em outras implantações.
                          </span>
                        </Field>
                      )}
                    </div>
                  )}
                </>
              )}

              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" checked={autoDeploy} onChange={(e) => setAutoDeploy(e.target.checked)} className="mt-0.5" />
                <span>
                  <span className="font-medium text-slate-700 dark:text-slate-200">Reimplantar automaticamente a cada push</span>
                  <span className="mt-0.5 block text-xs text-slate-500">
                    O Velix gera uma URL de webhook para você colar no repositório. Só pushes na branch acompanhada disparam
                    a reconstrução.
                  </span>
                </span>
              </label>
            </div>
          )}

          {currentKey === 'build' && (
            <div className="mx-auto max-w-xl space-y-3">
              <BuildOption
                selected={buildMethod === 'dockerfile'}
                onSelect={() => setBuildMethod('dockerfile')}
                title="Dockerfile"
                description="O repositório já tem um Dockerfile. O build usa exatamente o que está escrito nele."
              />
              <BuildOption
                selected={buildMethod === 'nixpacks'}
                onSelect={() => setBuildMethod('nixpacks')}
                title="Nixpacks"
                description="Sem Dockerfile: o Nixpacks detecta a linguagem (Node, Python, Go, PHP, Ruby...) e monta a imagem sozinho. É instalado no servidor na primeira vez."
              />

              {buildMethod === 'dockerfile' && (
                <Field label="Caminho do Dockerfile">
                  <input value={dockerfilePath} onChange={(e) => setDockerfilePath(e.target.value)} className="input" placeholder="Dockerfile" />
                  <span className="mt-1 block text-[11px] text-slate-400">Relativo à raiz do repositório. Ex.: docker/prod.Dockerfile</span>
                </Field>
              )}
            </div>
          )}

          {currentKey === 'server' && (
            <div className="mx-auto max-w-xl space-y-2">
              {(servers ?? []).map((s) => (
                <button
                  key={s.id}
                  onClick={() => setServerId(s.id)}
                  disabled={!s.dockerInstalled}
                  className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition disabled:opacity-50 ${
                    serverId === s.id ? 'border-indigo-400 bg-indigo-500/5' : 'border-slate-200 hover:border-slate-300 dark:border-slate-700'
                  }`}
                >
                  <IconServer className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                      {s.name}
                      {s.isLocal && <span className="ml-1.5 text-[10px] text-indigo-500">este servidor</span>}
                    </span>
                    <span className="block truncate text-xs text-slate-400">
                      {s.dockerInstalled ? 'Docker pronto' : 'Sem Docker — instale antes de implantar'}
                    </span>
                  </span>
                </button>
              ))}
              {servers?.length === 0 && <Alert variant="warning">Nenhum servidor cadastrado.</Alert>}
            </div>
          )}

          {currentKey === 'config' && (
            <div className="mx-auto max-w-xl space-y-4">
              <Field label={applicationId ? 'Nome do serviço' : 'Nome do projeto'}>
                <input
                  value={name}
                  onChange={(e) => {
                    setNameTouched(true);
                    setName(e.target.value);
                  }}
                  className="input"
                />
              </Field>

              <Field label="Porta interna">
                <input type="number" value={port} onChange={(e) => setPort(Number(e.target.value))} className="input" />
                <span className="mt-1 block text-[11px] text-slate-400">
                  A porta que a sua aplicação escuta dentro do container — a mesma do EXPOSE / do listen do seu código.
                </span>
              </Field>

              <Field label="Variáveis de ambiente (opcional)">
                <textarea
                  rows={4}
                  value={envText}
                  onChange={(e) => setEnvText(e.target.value)}
                  className="input font-mono text-xs"
                  placeholder={'NODE_ENV=production\nDATABASE_URL=postgres://...'}
                />
                <span className="mt-1 block text-[11px] text-slate-400">Uma por linha, no formato CHAVE=valor.</span>
              </Field>

              {selectedServer?.traefikInstalled && (
                <>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={wantsDomain} onChange={(e) => setWantsDomain(e.target.checked)} />
                    <span className="font-medium text-slate-700 dark:text-slate-200">Publicar com domínio e HTTPS</span>
                  </label>
                  {wantsDomain && (
                    <Field label="Domínio">
                      <div className="flex gap-2">
                        <input value={hostname} onChange={(e) => setHostname(e.target.value)} className="input" placeholder="app.seudominio.com" />
                        {zones.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setHostname(`${randomDomainLabel(name || repoName(repoUrl))}.${zones[0].name}`)}
                            title={`Gerar domínio aleatório em ${zones[0].name}`}
                            className="btn-secondary flex shrink-0 items-center gap-1.5 px-3 text-sm"
                          >
                            <IconRefresh className="h-4 w-4" aria-hidden />
                            Aleatório
                          </button>
                        )}
                      </div>
                    </Field>
                  )}
                </>
              )}
            </div>
          )}

          {currentKey === 'deploy' && createError && <Alert variant="error">{createError}</Alert>}
          {currentKey === 'deploy' && !createError && !resolvedAppId && <p className="text-sm text-slate-400">Criando o projeto...</p>}
          {currentKey === 'deploy' && serverId && resolvedAppId && (
            <>
              <DeployProgress
                stages={GIT_STAGES}
                lastLine={lastLine}
                state={result ? (result.ok ? 'success' : 'error') : 'running'}
                label={name.charAt(0).toUpperCase() || 'G'}
                title={result ? (result.ok ? `${name} está no ar` : 'A implantação falhou') : `Implantando ${name}`}
                subtitle={
                  result
                    ? result.ok
                      ? wantsDomain
                        ? 'Domínio configurado e certificado emitido.'
                        : 'Disponível na rede interna do servidor.'
                      : (result.error ?? 'Veja o log para entender o que aconteceu.')
                    : undefined
                }
                showLog={showLog}
                onToggleLog={() => setShowLog((v) => !v)}
              >
                {result?.ok && wantsDomain && (
                  <a href={`https://${hostname}`} target="_blank" rel="noreferrer" className="btn-primary mt-4 px-4 py-2 text-sm">
                    Abrir {hostname}
                  </a>
                )}
              </DeployProgress>

              {/* Sempre montado — é ele que conduz a implantação. */}
              <div className={showLog ? 'mt-3' : 'sr-only'}>
                <TerminalWindow title="Implantação" bodyClassName="flex h-[36vh] p-3">
                  <OpsLogPanel
                    serverId={serverId}
                    op="service-deploy-git"
                    params={{ applicationId: resolvedAppId, ...params }}
                    onLine={setLastLine}
                    onDone={(ok, res) => setResult({ ok, error: (res as { error?: string })?.error })}
                  />
                </TerminalWindow>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3.5 dark:border-slate-700">
          <button
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0 || currentKey === 'deploy'}
            className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-slate-800"
          >
            Voltar
          </button>

          {currentKey !== 'deploy' ? (
            <button onClick={() => setStep((s) => s + 1)} disabled={!stepValid[step]} className="btn-primary px-5 py-2 text-sm disabled:opacity-50">
              {visibleSteps[step + 1]?.key === 'deploy' ? 'Implantar' : 'Próximo'}
            </button>
          ) : (
            result && (
              <button onClick={onDeployed} className="btn-primary flex items-center gap-1.5 px-5 py-2 text-sm">
                {result.ok && <IconCheck className="h-4 w-4" aria-hidden />}
                Concluir
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}

function BuildOption({
  selected,
  onSelect,
  title,
  description,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  description: string;
}) {
  return (
    <button
      onClick={onSelect}
      className={`flex w-full items-start gap-3 rounded-xl border p-4 text-left transition ${
        selected ? 'border-indigo-400 bg-indigo-500/5' : 'border-slate-200 hover:border-slate-300 dark:border-slate-700'
      }`}
    >
      <span
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${
          selected ? 'border-indigo-500' : 'border-slate-300 dark:border-slate-600'
        }`}
      >
        {selected && <span className="h-2 w-2 rounded-full bg-indigo-500" />}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-slate-800 dark:text-slate-100">{title}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">{description}</span>
      </span>
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1.5 block font-medium text-slate-700 dark:text-slate-200">{label}</span>
      {children}
    </label>
  );
}
