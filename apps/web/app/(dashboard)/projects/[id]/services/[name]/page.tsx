'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { useAutoRefresh } from '@/lib/useAutoRefresh';
import { Alert } from '@/components/Alert';
import { Breadcrumb } from '@/components/Breadcrumb';
import { Skeleton } from '@/components/Skeleton';
import { StatusBadge, rowStatusBorderClass, type StatusTone } from '@/components/StatusBadge';
import { Modal, ConfirmModal } from '@/components/Modal';
import { LiveLogsPanel } from '@/components/LiveLogsPanel';
import { WebTerminal } from '@/components/WebTerminal';
import { AutoDeployModal } from '@/components/AutoDeployModal';
import { InstallLogModal } from '@/components/InstallLogModal';
import { MetricCard, MetricValue } from '@/components/MetricCard';
import { SqlImportButton } from '@/components/SqlImportButton';
import { PublishPortControl } from '@/components/PublishPortControl';
import { DeploymentHistoryCard } from '@/components/DeploymentHistoryCard';
import {
  IconActivity,
  IconGithub,
  IconKey,
  IconGlobe,
  IconShield,
  IconDisk,
  IconSettings,
  IconRefresh,
  IconPower,
  IconTrash,
  IconPlus,
  IconExternalLink,
  IconCopy,
  IconCheck,
  IconEye,
  IconEyeOff,
  IconTerminal,
  IconPencil,
  IconPlay,
  IconClock,
  IconArrowRightLeft,
} from '@/components/icons';
import type { ProjectDetail, ProjectService, ProjectDomain, EndpointServiceInfo, CatalogSecurityFinding } from '@/lib/types';

type TabKey = 'overview' | 'source' | 'history' | 'environment' | 'domains' | 'security' | 'resources' | 'terminal';

/** Mesma heurística de `apps/api/src/terminal/container-shell.util.ts` (não
 * dá pra reaproveitar entre front e back) — só decide se mostra o botão
 * extra "Console do banco"; a decisão de verdade é sempre refeita no
 * backend antes de abrir o shell. */
function looksLikeDatabase(image: string): boolean {
  const img = image.toLowerCase();
  return ['postgres', 'mysql', 'mariadb', 'mongo', 'redis'].some((needle) => img.includes(needle));
}

const SERVICE_STATUS_TONE: Record<ProjectService['status'], StatusTone> = {
  DEPLOYING: 'info',
  RUNNING: 'success',
  STOPPED: 'neutral',
  ERROR: 'danger',
};

const SERVICE_STATUS_LABEL: Record<ProjectService['status'], string> = {
  DEPLOYING: 'implantando',
  RUNNING: 'ativo',
  STOPPED: 'parado',
  ERROR: 'erro',
};

const RISK_TONE: Record<CatalogSecurityFinding['level'], StatusTone> = {
  low: 'neutral',
  medium: 'warning',
  high: 'danger',
  blocked: 'danger',
};

/**
 * Painel de UM serviço dentro do projeto — abas equivalentes ao que existia
 * espalhado em modais (ProjectServicesModal/DomainManagerModal/
 * AppCredentialsModal) antes da reestruturação em projetos, mais uma barra
 * de ações sempre visível no topo (implantar, iniciar/parar, reiniciar,
 * terminal, abrir, remover) e uma linha de CPU/Memória/Rede logo abaixo, em
 * vez de escondidas dentro de aba. O histórico de implantação
 * (`DeploymentHistoryCard`, alimentado por `ProjectDeploymentRun` no
 * backend) mostra cada deploy/redeploy com log completo — "Redirecionamentos"
 * e "Scripts" do EasyPanel continuam fora de escopo por enquanto.
 */
export default function ServicePage() {
  const params = useParams<{ id: string; name: string }>();
  const router = useRouter();
  const serviceName = decodeURIComponent(params.name);
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>('overview');
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [redeploying, setRedeploying] = useState(false);
  const [historyReloadKey, setHistoryReloadKey] = useState(0);
  const [showMovePicker, setShowMovePicker] = useState(false);
  const [moveTargetAppId, setMoveTargetAppId] = useState('');
  const [moving, setMoving] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [savingName, setSavingName] = useState(false);

  function load() {
    apiFetch<ProjectDetail>(`/applications/${params.id}`)
      .then(setProject)
      .catch((e) => setError(e instanceof Error ? e.message : 'Falha ao carregar'));
  }

  useEffect(load, [params.id]);
  useAutoRefresh(load, 15_000);

  if (error && !project) return <Alert variant="error">{error}</Alert>;
  if (!project) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  const service = project.services.find((s) => s.name === serviceName);
  if (!service) {
    return <Alert variant="error">Serviço &quot;{serviceName}&quot; não existe mais neste projeto.</Alert>;
  }
  const deployment = project.deployments.find((d) => d.id === service.deploymentId);
  const fromGit = deployment?.sourceType === 'git';
  const activeDomain = project.domains.find((d) => d.serviceName === service.name && d.status === 'ACTIVE');
  const running = service.status === 'RUNNING';
  // Rótulo mostrado (apelido ou nome cru) — `service.name` continua sendo a
  // chave funcional usada em toda URL/prop/comparação abaixo.
  const displayLabel = service.displayName ?? service.name;

  async function lifecycleAction(a: 'start' | 'stop' | 'restart') {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/applications/${project!.id}/services/${encodeURIComponent(service!.name)}/${a}`, { method: 'POST' });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao executar ação');
    } finally {
      setBusy(false);
    }
  }

  async function removeService() {
    setBusy(true);
    try {
      await apiFetch(`/applications/${project!.id}/deployments/${service!.deploymentId}`, { method: 'DELETE' });
      router.push(`/projects/${project!.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao remover serviço');
      setBusy(false);
      setConfirmRemove(false);
    }
  }

  async function saveDisplayName() {
    setSavingName(true);
    try {
      await apiFetch(`/applications/${project!.id}/services/${encodeURIComponent(service!.name)}`, {
        method: 'PATCH',
        body: JSON.stringify({ displayName: nameDraft }),
      });
      setRenaming(false);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao renomear serviço');
    } finally {
      setSavingName(false);
    }
  }

  const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
    { key: 'overview', label: 'Visão geral', icon: <IconActivity className="h-4 w-4" /> },
    ...(fromGit ? [{ key: 'source' as const, label: 'Fonte', icon: <IconGithub className="h-4 w-4" /> }] : []),
    ...(fromGit ? [{ key: 'history' as const, label: 'Histórico', icon: <IconClock className="h-4 w-4" /> }] : []),
    { key: 'environment', label: 'Ambiente', icon: <IconKey className="h-4 w-4" /> },
    { key: 'domains', label: 'Domínios', icon: <IconGlobe className="h-4 w-4" /> },
    { key: 'security', label: 'Segurança', icon: <IconShield className="h-4 w-4" /> },
    { key: 'resources', label: 'Recursos', icon: <IconDisk className="h-4 w-4" /> },
    { key: 'terminal', label: 'Terminal', icon: <IconTerminal className="h-4 w-4" /> },
  ];

  return (
    <div>
      <Breadcrumb
        items={[
          { label: 'Projetos', href: '/projects' },
          { label: project.name, href: `/projects/${project.id}` },
          { label: displayLabel },
        ]}
      />

      <div className="mb-4 flex items-center gap-2">
        {renaming ? (
          <>
            <input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveDisplayName();
                if (e.key === 'Escape') setRenaming(false);
              }}
              placeholder={service.name}
              className="page-title rounded-lg border border-slate-300 bg-transparent px-2 py-0.5 dark:border-slate-600"
            />
            <button
              onClick={saveDisplayName}
              disabled={savingName}
              className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-green-600 disabled:opacity-50 dark:hover:bg-slate-800"
              aria-label="Salvar nome"
            >
              <IconCheck className="h-4 w-4" aria-hidden />
            </button>
            <button
              onClick={() => setRenaming(false)}
              disabled={savingName}
              className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50 dark:hover:bg-slate-800"
              aria-label="Cancelar"
            >
              ✕
            </button>
          </>
        ) : (
          <>
            <h1 className="page-title">{displayLabel}</h1>
            <button
              onClick={() => {
                setNameDraft(displayLabel);
                setRenaming(true);
              }}
              className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-indigo-600 dark:hover:bg-slate-800"
              aria-label="Renomear serviço"
              title="Renomear"
            >
              <IconPencil className="h-3.5 w-3.5" aria-hidden />
            </button>
          </>
        )}
        <StatusBadge tone={SERVICE_STATUS_TONE[service.status]}>{SERVICE_STATUS_LABEL[service.status]}</StatusBadge>
      </div>

      <div className="card mb-4 flex flex-wrap items-center gap-2 p-2.5">
        {fromGit && (
          <button
            onClick={() => setRedeploying(true)}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-lg bg-green-600 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-green-700 disabled:opacity-50"
          >
            <IconPlay className="h-3.5 w-3.5" aria-hidden />
            Implantar
          </button>
        )}
        <span className="mx-0.5 h-6 w-px shrink-0 bg-slate-200 dark:bg-slate-700" aria-hidden />
        {running ? (
          <button
            onClick={() => lifecycleAction('stop')}
            disabled={busy}
            aria-label="Parar serviço"
            title="Parar serviço"
            className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <IconPower className="h-4 w-4" aria-hidden />
          </button>
        ) : (
          <button
            onClick={() => lifecycleAction('start')}
            disabled={busy}
            aria-label="Iniciar serviço"
            title="Iniciar serviço"
            className="rounded-lg p-2 text-indigo-600 transition hover:bg-indigo-50 disabled:opacity-50 dark:text-indigo-400 dark:hover:bg-indigo-500/10"
          >
            <IconPower className="h-4 w-4" aria-hidden />
          </button>
        )}
        <button
          onClick={() => lifecycleAction('restart')}
          disabled={busy}
          aria-label="Reiniciar serviço"
          title="Reiniciar serviço"
          className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        >
          <IconRefresh className="h-4 w-4" aria-hidden />
        </button>
        <button
          onClick={() => setTab('terminal')}
          aria-label="Abrir terminal"
          title="Terminal"
          className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        >
          <IconTerminal className="h-4 w-4" aria-hidden />
        </button>
        {activeDomain && (
          <a
            href={`https://${activeDomain.hostname}`}
            target="_blank"
            rel="noreferrer"
            aria-label="Abrir domínio"
            title="Abrir domínio"
            className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <IconExternalLink className="h-4 w-4" aria-hidden />
          </a>
        )}
        {!fromGit && (
          <button
            onClick={() => setShowMovePicker(true)}
            aria-label="Mover pra outro projeto"
            title="Mover pra outro projeto"
            className="ml-auto rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <IconArrowRightLeft className="h-4 w-4" aria-hidden />
          </button>
        )}
        <button
          onClick={() => setConfirmRemove(true)}
          aria-label="Remover serviço"
          title="Remover serviço"
          className={`rounded-lg p-2 text-slate-400 transition hover:bg-red-500/10 hover:text-red-500 ${fromGit ? 'ml-auto' : ''}`}
        >
          <IconTrash className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div className="mb-4">
        <ServiceStatsBar applicationId={project.id} serviceName={service.name} />
      </div>

      {error && (
        <div className="mb-4">
          <Alert variant="error">{error}</Alert>
        </div>
      )}

      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-700">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition ${
              tab === t.key
                ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab project={project} service={service} onChange={load} />}
      {tab === 'source' && deployment && <SourceTab project={project} deployment={deployment} onChange={load} />}
      {tab === 'history' && (
        <DeploymentHistoryCard applicationId={project.id} deploymentId={service.deploymentId} reloadKey={historyReloadKey} />
      )}
      {tab === 'environment' && deployment && (
        <EnvironmentTab applicationId={project.id} deploymentId={deployment.id} sourceType={deployment.sourceType} onChange={load} />
      )}
      {tab === 'domains' && <DomainsTab project={project} service={service} onChange={load} />}
      {tab === 'security' && deployment && <SecurityTab applicationId={project.id} deploymentId={deployment.id} />}
      {tab === 'resources' && <ResourcesTab applicationId={project.id} serviceName={service.name} />}
      {tab === 'terminal' && <ShellTab applicationId={project.id} service={service} />}

      {redeploying && (
        <InstallLogModal
          serverId={project.server.id}
          op="service-redeploy-git"
          params={{ deploymentId: service.deploymentId }}
          title={`Reimplantando ${displayLabel}`}
          onClose={() => {
            setRedeploying(false);
            load();
          }}
          onDone={() => {
            load();
            setHistoryReloadKey((k) => k + 1);
          }}
        />
      )}

      {confirmRemove && (
        <ConfirmModal
          title="Remover serviço"
          message={`Remover "${displayLabel}" deste projeto? Os containers e volumes desse serviço são apagados. O resto do projeto continua no ar.`}
          confirmLabel="Remover"
          danger
          loading={busy}
          onConfirm={removeService}
          onCancel={() => setConfirmRemove(false)}
        />
      )}

      {showMovePicker && (
        <MoveServiceModal
          currentApplicationId={project.id}
          currentServerId={project.server.id}
          onPick={(targetId) => {
            setMoveTargetAppId(targetId);
            setShowMovePicker(false);
            setMoving(true);
          }}
          onClose={() => setShowMovePicker(false)}
        />
      )}

      {moving && (
        <InstallLogModal
          serverId={project.server.id}
          op="service-move"
          params={{ deploymentId: service.deploymentId, targetApplicationId: moveTargetAppId }}
          title={`Movendo ${displayLabel}`}
          onClose={() => setMoving(false)}
          onDone={() => router.push(`/projects/${moveTargetAppId}/services/${encodeURIComponent(service.name)}`)}
        />
      )}
    </div>
  );
}

interface MoveTargetProject {
  id: string;
  name: string;
  server: { id: string };
}

/** Lista só projetos do MESMO servidor — mover entre servidores exigiria
 * transferir dado de verdade (SSH-to-SSH), fora de escopo por enquanto (ver
 * docstring de `moveDeployment` no backend). */
function MoveServiceModal({
  currentApplicationId,
  currentServerId,
  onPick,
  onClose,
}: {
  currentApplicationId: string;
  currentServerId: string;
  onPick: (targetApplicationId: string) => void;
  onClose: () => void;
}) {
  const [projects, setProjects] = useState<MoveTargetProject[] | null>(null);
  const [selected, setSelected] = useState('');

  useEffect(() => {
    apiFetch<MoveTargetProject[]>('/applications')
      .then((list) => setProjects(list.filter((p) => p.id !== currentApplicationId && p.server.id === currentServerId)))
      .catch(() => setProjects([]));
  }, [currentApplicationId, currentServerId]);

  return (
    <Modal title="Mover pra outro projeto" onClose={onClose} maxWidth="max-w-sm">
      <div className="space-y-4">
        <p className="text-xs text-slate-400">
          O container é recriado no projeto de destino (nome e rede mudam) — os dados continuam, mas o serviço reinicia
          rapidamente. Só entre projetos do mesmo servidor.
        </p>
        {!projects ? (
          <Skeleton className="h-9" />
        ) : projects.length === 0 ? (
          <p className="text-sm text-slate-400">Nenhum outro projeto neste servidor.</p>
        ) : (
          <select value={selected} onChange={(e) => setSelected(e.target.value)} className="input" autoFocus>
            <option value="">Selecione um projeto...</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary px-3.5 py-2 text-sm">
            Cancelar
          </button>
          <button onClick={() => onPick(selected)} disabled={!selected} className="btn-primary px-3.5 py-2 text-sm disabled:opacity-50">
            Mover
          </button>
        </div>
      </div>
    </Modal>
  );
}

function OverviewTab({
  project,
  service,
  onChange,
}: {
  project: ProjectDetail;
  service: ProjectService;
  onChange: () => void;
}) {
  const [endpoints, setEndpoints] = useState<EndpointServiceInfo[] | null>(null);

  useEffect(() => {
    apiFetch<EndpointServiceInfo[]>(`/applications/${project.id}/endpoints`)
      .then(setEndpoints)
      .catch(() => {});
  }, [project.id]);

  const endpoint = endpoints?.find((e) => e.serviceName === service.name);
  const isDb = looksLikeDatabase(service.image);

  return (
    <div className="space-y-4">
      <div className="card grid grid-cols-1 gap-4 p-4 text-sm sm:grid-cols-2">
        <div>
          <p className="text-xs text-slate-400">Imagem</p>
          <p className="truncate font-mono text-xs text-slate-700 dark:text-slate-200">{service.image}</p>
        </div>
        <div>
          <p className="text-xs text-slate-400">Container</p>
          <p className="truncate font-mono text-xs text-slate-700 dark:text-slate-200">{service.containerName}</p>
        </div>
        <div>
          <p className="text-xs text-slate-400">Rodando</p>
          <p className="text-slate-700 dark:text-slate-200">{endpoint?.running ? 'Sim' : 'Não'}</p>
        </div>
        <div>
          <p className="text-xs text-slate-400">Portas internas</p>
          <p className="text-slate-700 dark:text-slate-200">
            {endpoint?.ports.length ? endpoint.ports.map((p) => `${p.port}/${p.protocol}`).join(', ') : '—'}
          </p>
        </div>
      </div>

      {isDb && (
        <div className="card space-y-3 p-3.5">
          <p className="section-label">Ferramentas de banco</p>
          <div className="flex flex-wrap gap-2">
            <SqlImportButton
              applicationId={project.id}
              serviceName={service.name}
              image={service.image}
              serverId={project.server.id}
            />
            <a href={`/databases/${service.id}`} className="btn-secondary flex items-center gap-1.5 px-3.5 py-2 text-sm">
              <IconGlobe className="h-4 w-4" aria-hidden />
              Gerenciar dados
            </a>
          </div>
          <PublishPortControl
            applicationId={project.id}
            serviceName={service.name}
            publishedPort={service.publishedPort}
            onChange={onChange}
          />
        </div>
      )}

      <LiveLogsPanel serverId={project.server.id} containerId={service.containerName} />
    </div>
  );
}

function SourceTab({
  project,
  deployment,
  onChange,
}: {
  project: ProjectDetail;
  deployment: NonNullable<ProjectDetail['deployments'][number]>;
  onChange: () => void;
}) {
  const [showAutoDeploy, setShowAutoDeploy] = useState(false);

  return (
    <div className="space-y-4">
      <div className="card space-y-2.5 p-4 text-sm">
        <Row label="Repositório" value={deployment.repoUrl?.replace('https://', '').replace('.git', '') ?? '—'} />
        <Row label="Branch/tag" value={deployment.gitRef ?? '—'} />
        <Row label="Build" value={deployment.buildMethod === 'nixpacks' ? 'Nixpacks' : 'Dockerfile'} />
        {deployment.buildMethod === 'dockerfile' && <Row label="Caminho do Dockerfile" value={deployment.dockerfilePath ?? 'Dockerfile'} />}
        <Row label="Autodeploy" value={deployment.autoDeploy ? 'Ativado' : 'Desativado'} />
      </div>

      <button onClick={() => setShowAutoDeploy(true)} className="btn-secondary flex items-center gap-1.5 px-3.5 py-2 text-sm">
        <IconSettings className="h-4 w-4" aria-hidden />
        Configurar autodeploy
      </button>

      {showAutoDeploy && (
        <AutoDeployModal
          applicationId={project.id}
          deploymentId={deployment.id}
          appName={project.name}
          onClose={() => {
            setShowAutoDeploy(false);
            onChange();
          }}
        />
      )}
    </div>
  );
}

function EnvironmentTab({
  applicationId,
  deploymentId,
  sourceType,
  onChange,
}: {
  applicationId: string;
  deploymentId: string;
  sourceType: string;
  onChange: () => void;
}) {
  const [credentials, setCredentials] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Record<string, string>>(`/applications/${applicationId}/deployments/${deploymentId}/credentials`)
      .then(setCredentials)
      .catch((e) => setError(e instanceof Error ? e.message : 'Falha ao carregar'));
  }, [applicationId, deploymentId]);

  function copy(key: string, value: string) {
    navigator.clipboard.writeText(value);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  }

  const entries = credentials ? Object.entries(credentials) : [];
  const isGit = sourceType === 'git';

  return (
    <div className="space-y-4">
      {error && <Alert variant="error">{error}</Alert>}
      {!credentials && !error && <Skeleton className="h-24" />}

      {credentials && entries.length > 0 && (
        <div className="card p-3.5">
          <div className="mb-3 flex items-center justify-between">
            <p className="section-label">Segredos gerados</p>
            <button onClick={() => setRevealed((v) => !v)} className="flex items-center gap-1 text-xs text-indigo-600 hover:underline dark:text-indigo-400">
              {revealed ? <IconEyeOff className="h-3.5 w-3.5" /> : <IconEye className="h-3.5 w-3.5" />}
              {revealed ? 'Ocultar valores' : 'Mostrar valores'}
            </button>
          </div>
          <div className="space-y-2">
            {entries.map(([key, value]) => (
              <div key={key} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
                <div className="min-w-0">
                  <p className="text-xs text-slate-500">{key}</p>
                  <p className="truncate font-mono text-sm">{revealed ? value : '••••••••••••'}</p>
                </div>
                <button onClick={() => copy(key, value)} className="shrink-0 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                  {copiedKey === key ? (
                    <span className="flex items-center gap-1"><IconCheck className="h-3.5 w-3.5" />Copiado</span>
                  ) : (
                    <span className="flex items-center gap-1"><IconCopy className="h-3.5 w-3.5" />Copiar</span>
                  )}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {credentials && isGit && <GitEnvEditor applicationId={applicationId} deploymentId={deploymentId} onChange={onChange} />}

      {credentials && !isGit && entries.length === 0 && <p className="text-sm text-slate-400">Este serviço não gerou segredos.</p>}
    </div>
  );
}

type EnvMode = 'list' | 'bulk';

function envToBulkText(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
}

function bulkTextToEnv(text: string): Record<string, string> {
  return Object.fromEntries(
    text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => {
        const i = l.indexOf('=');
        return i === -1 ? [l, ''] : [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      })
      .filter(([k]) => k),
  );
}

/** Variáveis de ambiente de um serviço implantado a partir de repositório —
 * duas formas de editar a mesma lista: uma a uma (menos erro pra poucas
 * variáveis) ou tudo de uma vez em texto CHAVE=valor (mais rápido pra colar
 * um .env inteiro). Salvar recria o container sem reconstruir a imagem. */
function GitEnvEditor({ applicationId, deploymentId, onChange }: { applicationId: string; deploymentId: string; onChange: () => void }) {
  const [env, setEnv] = useState<Record<string, string> | null>(null);
  const [rows, setRows] = useState<{ key: string; value: string }[]>([]);
  const [bulkText, setBulkText] = useState('');
  const [mode, setMode] = useState<EnvMode>('list');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    apiFetch<Record<string, string>>(`/applications/${applicationId}/deployments/${deploymentId}/env`)
      .then((data) => {
        setEnv(data);
        setRows(Object.entries(data).map(([key, value]) => ({ key, value })));
        setBulkText(envToBulkText(data));
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Falha ao carregar'));
  }, [applicationId, deploymentId]);

  function switchMode(next: EnvMode) {
    if (next === mode) return;
    if (next === 'bulk') {
      setBulkText(envToBulkText(Object.fromEntries(rows.filter((r) => r.key.trim()).map((r) => [r.key.trim(), r.value]))));
    } else {
      setRows(Object.entries(bulkTextToEnv(bulkText)).map(([key, value]) => ({ key, value })));
    }
    setMode(next);
  }

  function updateRow(i: number, field: 'key' | 'value', v: string) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: v } : r)));
  }

  function removeRow(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function save() {
    const finalEnv =
      mode === 'bulk' ? bulkTextToEnv(bulkText) : Object.fromEntries(rows.filter((r) => r.key.trim()).map((r) => [r.key.trim(), r.value]));
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await apiFetch(`/applications/${applicationId}/deployments/${deploymentId}/env`, {
        method: 'PATCH',
        body: JSON.stringify({ env: finalEnv }),
      });
      setEnv(finalEnv);
      setRows(Object.entries(finalEnv).map(([key, value]) => ({ key, value })));
      setBulkText(envToBulkText(finalEnv));
      setSaved(true);
      onChange();
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao salvar');
    } finally {
      setSaving(false);
    }
  }

  if (!env) return <Skeleton className="h-24" />;

  return (
    <div className="card space-y-3 p-3.5">
      <div className="flex items-center justify-between">
        <p className="section-label">Variáveis de ambiente</p>
        <div className="flex gap-1 rounded-lg border border-slate-200 p-0.5 text-xs dark:border-slate-700">
          <button
            onClick={() => switchMode('list')}
            className={`rounded-md px-2.5 py-1 font-medium transition ${
              mode === 'list' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'
            }`}
          >
            Uma a uma
          </button>
          <button
            onClick={() => switchMode('bulk')}
            className={`rounded-md px-2.5 py-1 font-medium transition ${
              mode === 'bulk' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'
            }`}
          >
            Editar tudo
          </button>
        </div>
      </div>

      {mode === 'list' ? (
        <div className="space-y-2">
          {rows.length === 0 && <p className="text-sm text-slate-400">Nenhuma variável definida.</p>}
          {rows.map((row, i) => (
            <div key={i} className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="flex flex-1 gap-2">
                <input
                  value={row.key}
                  onChange={(e) => updateRow(i, 'key', e.target.value)}
                  placeholder="CHAVE"
                  className="input h-9 flex-1 font-mono text-xs uppercase"
                />
                <input
                  value={row.value}
                  onChange={(e) => updateRow(i, 'value', e.target.value)}
                  placeholder="valor"
                  className="input h-9 flex-1 font-mono text-xs"
                />
              </div>
              <button
                onClick={() => removeRow(i)}
                className="flex shrink-0 items-center justify-center gap-1.5 self-end rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10 sm:self-auto"
                aria-label="Remover variável"
              >
                <IconTrash className="h-4 w-4" aria-hidden />
              </button>
            </div>
          ))}
          <button
            onClick={() => setRows((prev) => [...prev, { key: '', value: '' }])}
            className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
          >
            <IconPlus className="h-3.5 w-3.5" aria-hidden />
            Adicionar variável
          </button>
        </div>
      ) : (
        <textarea
          value={bulkText}
          onChange={(e) => setBulkText(e.target.value)}
          placeholder={'CHAVE=valor\nOUTRA_CHAVE=outro valor'}
          rows={8}
          className="input font-mono text-xs"
        />
      )}

      {error && <Alert variant="error">{error}</Alert>}

      <div className="flex items-center justify-end gap-2">
        {saved && <span className="text-xs text-green-600 dark:text-green-400">Salvo — container recriado.</span>}
        <button onClick={save} disabled={saving} className="btn-primary px-3.5 py-2 text-sm disabled:opacity-50">
          {saving ? 'Salvando...' : 'Salvar'}
        </button>
      </div>
      <p className="text-[11px] text-slate-400">Salvar recria o container com as novas variáveis — a imagem não é reconstruída.</p>
    </div>
  );
}

const DOMAIN_TONE: Record<string, StatusTone> = {
  ACTIVE: 'success',
  PENDING: 'info',
  ERROR: 'danger',
};

interface CloudflareZoneOption {
  id: string;
  name: string;
  status: string;
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

function DomainsTab({
  project,
  service,
  onChange,
}: {
  project: ProjectDetail;
  service: ProjectService;
  onChange: () => void;
}) {
  const [endpoints, setEndpoints] = useState<EndpointServiceInfo[] | null>(null);
  const [zones, setZones] = useState<CloudflareZoneOption[]>([]);
  const [formTarget, setFormTarget] = useState<'new' | ProjectDomain | null>(null);
  const [hostname, setHostname] = useState('');
  const [port, setPort] = useState<number | null>(null);
  const [createDnsRecord, setCreateDnsRecord] = useState(true);
  const [proxied, setProxied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<EndpointServiceInfo[]>(`/applications/${project.id}/endpoints`)
      .then((list) => {
        setEndpoints(list);
        const endpoint = list.find((e) => e.serviceName === service.name);
        const recommended = endpoint?.ports.find((p) => p.recommended) ?? endpoint?.ports[0];
        if (recommended) setPort(recommended.port);
      })
      .catch(() => {});
    // Sem conta Cloudflare conectada, a API devolve 404 — sem problema, só
    // significa que o botão de gerar domínio aleatório fica escondido.
    apiFetch<CloudflareZoneOption[]>('/cloudflare/zones')
      .then(setZones)
      .catch(() => {});
  }, [project.id, service.name]);

  const domains = project.domains.filter((d) => d.serviceName === service.name);
  const endpoint = endpoints?.find((e) => e.serviceName === service.name);
  const isEditing = formTarget !== null && formTarget !== 'new';

  function openAdd() {
    setError(null);
    setHostname('');
    const recommended = endpoint?.ports.find((p) => p.recommended) ?? endpoint?.ports[0];
    setPort(recommended?.port ?? null);
    setCreateDnsRecord(true);
    setProxied(false);
    setFormTarget('new');
  }

  function openEdit(domain: ProjectDomain) {
    setError(null);
    setHostname(domain.hostname);
    setPort(domain.targetPort);
    setFormTarget(domain);
  }

  function generateRandom() {
    if (zones.length === 0) return;
    setHostname(`${randomDomainLabel(service.name)}.${zones[0].name}`);
  }

  async function submit() {
    if (!hostname.trim() || !port) return;
    setSaving(true);
    setError(null);
    try {
      if (formTarget && formTarget !== 'new') {
        await apiFetch(`/applications/${project.id}/domains/${formTarget.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ hostname: formTarget.hostname, serviceName: service.name, port }),
        });
      } else {
        await apiFetch(`/applications/${project.id}/domains`, {
          method: 'POST',
          body: JSON.stringify({ hostname: hostname.trim(), serviceName: service.name, port, createDnsRecord, proxied }),
        });
      }
      setFormTarget(null);
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao salvar domínio');
    } finally {
      setSaving(false);
    }
  }

  async function remove(domainId: string) {
    setRemovingId(domainId);
    setError(null);
    try {
      await apiFetch(`/domains/${domainId}`, { method: 'DELETE' });
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao remover domínio');
    } finally {
      setRemovingId(null);
    }
  }

  async function verify(domainId: string) {
    setVerifyingId(domainId);
    setError(null);
    try {
      await apiFetch(`/domains/${domainId}/verify`);
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao verificar domínio');
    } finally {
      setVerifyingId(null);
    }
  }

  return (
    <div className="space-y-4">
      {error && <Alert variant="error">{error}</Alert>}
      {domains.length === 0 ? (
        <p className="text-sm text-slate-400">Nenhum domínio associado a este serviço.</p>
      ) : (
        <div className="card divide-y divide-slate-100 overflow-hidden dark:divide-slate-700">
          {domains.map((d) => (
            <div key={d.id} className={`flex items-center justify-between gap-3 border-l-[3px] ${rowStatusBorderClass(DOMAIN_TONE[d.status] ?? 'neutral')} py-2.5 pl-3.5 pr-4`}>
              <div className="flex min-w-0 items-center gap-2.5">
                <IconGlobe className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                <div className="min-w-0">
                  <p className="truncate font-mono text-sm font-medium text-slate-700 dark:text-slate-200">{d.hostname}</p>
                  <p className="font-mono text-xs text-slate-400">porta {d.targetPort}</p>
                  {d.status === 'ERROR' && d.lastError && <p className="truncate text-xs text-red-500 dark:text-red-400">{d.lastError}</p>}
                  {d.status === 'PENDING' && (
                    <p className="truncate text-xs text-slate-400">Aguardando DNS/certificado — verificado automaticamente a cada poucos minutos</p>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <a
                  href={`https://${d.hostname}`}
                  target="_blank"
                  rel="noreferrer"
                  title={d.status !== 'ACTIVE' ? 'Domínio ainda não verificado — pode não abrir ainda' : undefined}
                  className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-indigo-600 dark:hover:bg-slate-700"
                  aria-label="Abrir domínio"
                >
                  <IconExternalLink className="h-4 w-4" aria-hidden />
                </a>
                {d.status !== 'ACTIVE' && (
                  <button
                    onClick={() => verify(d.id)}
                    disabled={verifyingId === d.id}
                    title="Verificar agora"
                    className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-indigo-600 disabled:opacity-50 dark:hover:bg-slate-700"
                    aria-label="Verificar domínio"
                  >
                    <IconRefresh className={`h-4 w-4 ${verifyingId === d.id ? 'animate-spin' : ''}`} aria-hidden />
                  </button>
                )}
                <button
                  onClick={() => openEdit(d)}
                  className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-indigo-600 dark:hover:bg-slate-700"
                  aria-label="Editar domínio"
                >
                  <IconPencil className="h-4 w-4" aria-hidden />
                </button>
                <button
                  onClick={() => remove(d.id)}
                  disabled={removingId === d.id}
                  className="rounded-lg p-2 text-slate-400 transition hover:bg-red-50 hover:text-red-500 disabled:opacity-50 dark:hover:bg-red-500/10"
                  aria-label="Remover domínio"
                >
                  <IconTrash className="h-4 w-4" aria-hidden />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {formTarget === null ? (
        <button onClick={openAdd} className="btn-secondary flex items-center gap-1.5 px-3.5 py-2 text-sm">
          <IconPlus className="h-4 w-4" aria-hidden />
          Adicionar domínio
        </button>
      ) : (
        <div className="card space-y-3 p-3.5">
          <p className="section-label">{isEditing ? 'Editar domínio' : 'Novo domínio'}</p>
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-slate-700 dark:text-slate-200">Domínio</span>
            <div className="flex gap-2">
              <input
                value={hostname}
                onChange={(e) => setHostname(e.target.value)}
                placeholder="app.seudominio.com"
                disabled={isEditing}
                className="input disabled:opacity-60"
              />
              {!isEditing && zones.length > 0 && (
                <button
                  type="button"
                  onClick={generateRandom}
                  title={`Gerar domínio aleatório em ${zones[0].name}`}
                  className="btn-secondary flex shrink-0 items-center gap-1.5 px-3 text-sm"
                >
                  <IconRefresh className="h-4 w-4" aria-hidden />
                  Aleatório
                </button>
              )}
            </div>
            {isEditing && (
              <p className="mt-1.5 text-xs text-slate-400">
                O nome do domínio não pode ser trocado por aqui — remova e crie um novo se precisar de outro.
              </p>
            )}
          </label>
          {endpoint && endpoint.ports.length > 1 && (
            <label className="block text-sm">
              <span className="mb-1.5 block font-medium text-slate-700 dark:text-slate-200">Porta</span>
              <select value={port ?? ''} onChange={(e) => setPort(Number(e.target.value))} className="input">
                {endpoint.ports.map((p) => (
                  <option key={p.port} value={p.port}>
                    {p.port}/{p.protocol}
                  </option>
                ))}
              </select>
            </label>
          )}
          {!isEditing && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={createDnsRecord} onChange={(e) => setCreateDnsRecord(e.target.checked)} />
              Criar registro DNS na Cloudflare automaticamente
            </label>
          )}
          {!isEditing && createDnsRecord && (
            <label className="flex items-center gap-2 pl-6 text-sm text-slate-600 dark:text-slate-300">
              <input type="checkbox" checked={proxied} onChange={(e) => setProxied(e.target.checked)} />
              Ativar proxy da Cloudflare (nuvem laranja)
              <span className="text-xs text-slate-400">— esconde o IP real e passa pela CDN/WAF</span>
            </label>
          )}
          <div className="flex justify-end gap-2">
            <button onClick={() => setFormTarget(null)} className="btn-secondary px-3.5 py-2 text-sm">
              Cancelar
            </button>
            <button onClick={submit} disabled={saving || !hostname.trim() || !port} className="btn-primary px-3.5 py-2 text-sm disabled:opacity-50">
              {saving ? 'Salvando...' : isEditing ? 'Salvar' : 'Criar'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SecurityTab({ applicationId, deploymentId }: { applicationId: string; deploymentId: string }) {
  const [data, setData] = useState<{ risks: CatalogSecurityFinding[]; highest: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ risks: CatalogSecurityFinding[]; highest: string }>(`/applications/${applicationId}/deployments/${deploymentId}/security`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Falha ao carregar'));
  }, [applicationId, deploymentId]);

  if (error) return <Alert variant="error">{error}</Alert>;
  if (!data) return <Skeleton className="h-24" />;
  if (data.risks.length === 0) return <p className="text-sm text-slate-400">Nenhum risco conhecido identificado neste serviço.</p>;

  return (
    <div className="card divide-y divide-slate-100 overflow-hidden dark:divide-slate-700">
      {data.risks.map((risk, i) => (
        <div key={i} className={`flex items-start gap-3 border-l-[3px] ${rowStatusBorderClass(RISK_TONE[risk.level])} py-2.5 pl-3.5 pr-4`}>
          <p className="text-sm text-slate-700 dark:text-slate-200">{risk.message}</p>
        </div>
      ))}
    </div>
  );
}

/** Mesmos dados de `ResourcesTab`, só que sempre visível abaixo da barra de
 * ações — em vez de escondido dentro da aba "Recursos" — pra dar a visão
 * rápida de CPU/Memória/Rede que o print de referência mostrava. */
function ServiceStatsBar({ applicationId, serviceName }: { applicationId: string; serviceName: string }) {
  const [stats, setStats] = useState<{ cpu: string | null; memory: string | null; network: string | null } | null>(null);

  function load() {
    apiFetch<{ cpu: string | null; memory: string | null; network: string | null }>(
      `/applications/${applicationId}/services/${encodeURIComponent(serviceName)}/stats`,
    )
      .then(setStats)
      .catch(() => {});
  }

  useEffect(load, [applicationId, serviceName]);
  useAutoRefresh(load, 5_000);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <MetricCard icon={<IconActivity className="h-3.5 w-3.5" />} label="CPU">
        <MetricValue>{stats?.cpu ?? '—'}</MetricValue>
      </MetricCard>
      <MetricCard icon={<IconDisk className="h-3.5 w-3.5" />} label="Memória">
        <MetricValue>{stats?.memory ?? '—'}</MetricValue>
      </MetricCard>
      <MetricCard icon={<IconGlobe className="h-3.5 w-3.5" />} label="Rede (I/O)">
        <MetricValue>{stats?.network ?? '—'}</MetricValue>
      </MetricCard>
    </div>
  );
}

function ResourcesTab({ applicationId, serviceName }: { applicationId: string; serviceName: string }) {
  const [stats, setStats] = useState<{ cpu: string | null; memory: string | null; network: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    apiFetch<{ cpu: string | null; memory: string | null; network: string | null }>(
      `/applications/${applicationId}/services/${encodeURIComponent(serviceName)}/stats`,
    )
      .then(setStats)
      .catch((e) => setError(e instanceof Error ? e.message : 'Falha ao carregar'));
  }

  useEffect(load, [applicationId, serviceName]);
  useAutoRefresh(load, 5_000);

  if (error) return <Alert variant="error">{error}</Alert>;
  if (!stats) return <Skeleton className="h-24" />;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <MetricCard icon={<IconActivity className="h-3.5 w-3.5" />} label="CPU">
        <MetricValue>{stats.cpu ?? '—'}</MetricValue>
      </MetricCard>
      <MetricCard icon={<IconDisk className="h-3.5 w-3.5" />} label="Memória">
        <MetricValue>{stats.memory ?? '—'}</MetricValue>
      </MetricCard>
      <MetricCard icon={<IconGlobe className="h-3.5 w-3.5" />} label="Rede (I/O)">
        <MetricValue>{stats.network ?? '—'}</MetricValue>
      </MetricCard>
    </div>
  );
}

function ShellTab({ applicationId, service }: { applicationId: string; service: ProjectService }) {
  const [mode, setMode] = useState<'shell' | 'db'>('shell');
  const [shell, setShell] = useState<'sh' | 'bash'>('sh');
  const [session, setSession] = useState<{ mode: 'shell' | 'db'; shell: 'sh' | 'bash' } | null>(null);
  const showDbOption = looksLikeDatabase(service.image);

  if (session) {
    const wsPath = `/service-terminal?applicationId=${applicationId}&serviceName=${encodeURIComponent(service.name)}&mode=${session.mode}&shell=${session.shell}`;
    const title =
      session.mode === 'db'
        ? `Console — ${service.name}`
        : `Shell (${session.shell}) — ${service.name}`;
    return (
      <div className="space-y-3">
        <button onClick={() => setSession(null)} className="text-xs text-slate-400 hover:text-indigo-500">
          ← Trocar
        </button>
        <WebTerminal key={`${session.mode}-${session.shell}`} wsPath={wsPath} title={title} />
      </div>
    );
  }

  return (
    <div className="card max-w-md space-y-4 p-4">
      {showDbOption && (
        <div>
          <p className="mb-1.5 text-sm font-medium text-slate-700 dark:text-slate-200">O que abrir</p>
          <div className="flex gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800/60">
            <button onClick={() => setMode('shell')} className={`tab-pill flex-1 ${mode === 'shell' ? 'tab-pill-active' : ''}`}>
              Shell
            </button>
            <button onClick={() => setMode('db')} className={`tab-pill flex-1 ${mode === 'db' ? 'tab-pill-active' : ''}`}>
              Console do banco
            </button>
          </div>
        </div>
      )}

      {mode === 'shell' && (
        <div>
          <p className="mb-1.5 text-sm font-medium text-slate-700 dark:text-slate-200">Shell</p>
          <div className="flex gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800/60">
            <button onClick={() => setShell('sh')} className={`tab-pill flex-1 ${shell === 'sh' ? 'tab-pill-active' : ''}`}>
              sh
            </button>
            <button onClick={() => setShell('bash')} className={`tab-pill flex-1 ${shell === 'bash' ? 'tab-pill-active' : ''}`}>
              bash
            </button>
          </div>
          <p className="mt-1.5 text-[11px] text-slate-400">
            Nem toda imagem tem bash — se a conexão falhar, tente sh (quase sempre disponível).
          </p>
        </div>
      )}

      <button onClick={() => setSession({ mode, shell })} className="btn-primary w-full py-2 text-sm">
        Conectar
      </button>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-slate-400">{label}</span>
      <span className="truncate text-right text-slate-700 dark:text-slate-200">{value}</span>
    </div>
  );
}
