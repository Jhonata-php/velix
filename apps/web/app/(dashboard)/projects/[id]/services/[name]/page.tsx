'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { useAutoRefresh } from '@/lib/useAutoRefresh';
import { Alert } from '@/components/Alert';
import { Breadcrumb } from '@/components/Breadcrumb';
import { Skeleton } from '@/components/Skeleton';
import { StatusBadge, type StatusTone } from '@/components/StatusBadge';
import { ConfirmModal } from '@/components/Modal';
import { LiveLogsPanel } from '@/components/LiveLogsPanel';
import { AutoDeployModal } from '@/components/AutoDeployModal';
import { InstallLogModal } from '@/components/InstallLogModal';
import { MetricCard, MetricValue } from '@/components/MetricCard';
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
} from '@/components/icons';
import type { ProjectDetail, ProjectService, EndpointServiceInfo, CatalogSecurityFinding } from '@/lib/types';

type TabKey = 'overview' | 'source' | 'environment' | 'domains' | 'security' | 'resources';

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
 * de ações sempre visível no topo (iniciar/parar, reiniciar, reimplantar,
 * abrir, remover) em vez de escondidas dentro de uma aba — pedido explícito
 * do usuário pra bater mais com o que ele já usava antes. "Implantações"
 * (histórico/rollback), "Redirecionamentos" e "Scripts" do EasyPanel ficam
 * pra uma fase seguinte — combinado com o usuário, não são reorganização de
 * UI, são recursos novos do zero.
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

  const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
    { key: 'overview', label: 'Visão geral', icon: <IconActivity className="h-4 w-4" /> },
    ...(fromGit ? [{ key: 'source' as const, label: 'Fonte', icon: <IconGithub className="h-4 w-4" /> }] : []),
    { key: 'environment', label: 'Ambiente', icon: <IconKey className="h-4 w-4" /> },
    { key: 'domains', label: 'Domínios', icon: <IconGlobe className="h-4 w-4" /> },
    { key: 'security', label: 'Segurança', icon: <IconShield className="h-4 w-4" /> },
    { key: 'resources', label: 'Recursos', icon: <IconDisk className="h-4 w-4" /> },
  ];

  return (
    <div>
      <Breadcrumb
        items={[
          { label: 'Projetos', href: '/projects' },
          { label: project.name, href: `/projects/${project.id}` },
          { label: service.name },
        ]}
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="page-title">{service.name}</h1>
          <StatusBadge tone={SERVICE_STATUS_TONE[service.status]}>{SERVICE_STATUS_LABEL[service.status]}</StatusBadge>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {running ? (
            <button onClick={() => lifecycleAction('stop')} disabled={busy} className="btn-secondary flex items-center gap-1.5 px-3.5 py-2 text-sm disabled:opacity-50">
              <IconPower className="h-4 w-4" aria-hidden />
              Parar
            </button>
          ) : (
            <button onClick={() => lifecycleAction('start')} disabled={busy} className="btn-primary flex items-center gap-1.5 px-3.5 py-2 text-sm disabled:opacity-50">
              <IconPower className="h-4 w-4" aria-hidden />
              Iniciar
            </button>
          )}
          <button onClick={() => lifecycleAction('restart')} disabled={busy} className="btn-secondary flex items-center gap-1.5 px-3.5 py-2 text-sm disabled:opacity-50">
            <IconRefresh className="h-4 w-4" aria-hidden />
            Reiniciar
          </button>
          {fromGit && (
            <button onClick={() => setRedeploying(true)} disabled={busy} className="btn-secondary flex items-center gap-1.5 px-3.5 py-2 text-sm disabled:opacity-50">
              <IconGithub className="h-4 w-4" aria-hidden />
              Reimplantar
            </button>
          )}
          {activeDomain && (
            <a
              href={`https://${activeDomain.hostname}`}
              target="_blank"
              rel="noreferrer"
              className="btn-secondary flex items-center gap-1.5 px-3.5 py-2 text-sm"
            >
              <IconExternalLink className="h-4 w-4" aria-hidden />
              Abrir
            </a>
          )}
          <button
            onClick={() => setConfirmRemove(true)}
            aria-label="Remover serviço"
            title="Remover serviço"
            className="rounded-lg p-2 text-slate-400 transition hover:bg-red-500/10 hover:text-red-500"
          >
            <IconTrash className="h-4 w-4" aria-hidden />
          </button>
        </div>
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

      {tab === 'overview' && <OverviewTab project={project} service={service} />}
      {tab === 'source' && deployment && <SourceTab project={project} deployment={deployment} onChange={load} />}
      {tab === 'environment' && deployment && <EnvironmentTab applicationId={project.id} deploymentId={deployment.id} />}
      {tab === 'domains' && <DomainsTab project={project} service={service} onChange={load} />}
      {tab === 'security' && deployment && <SecurityTab applicationId={project.id} deploymentId={deployment.id} />}
      {tab === 'resources' && <ResourcesTab applicationId={project.id} serviceName={service.name} />}

      {redeploying && (
        <InstallLogModal
          serverId={project.server.id}
          op="service-redeploy-git"
          params={{ deploymentId: service.deploymentId }}
          title={`Reimplantando ${service.name}`}
          onClose={() => {
            setRedeploying(false);
            load();
          }}
          onDone={load}
        />
      )}

      {confirmRemove && (
        <ConfirmModal
          title="Remover serviço"
          message={`Remover "${service.name}" deste projeto? Os containers e volumes desse serviço são apagados. O resto do projeto continua no ar.`}
          confirmLabel="Remover"
          danger
          loading={busy}
          onConfirm={removeService}
          onCancel={() => setConfirmRemove(false)}
        />
      )}
    </div>
  );
}

function OverviewTab({ project, service }: { project: ProjectDetail; service: ProjectService }) {
  const [endpoints, setEndpoints] = useState<EndpointServiceInfo[] | null>(null);

  useEffect(() => {
    apiFetch<EndpointServiceInfo[]>(`/applications/${project.id}/endpoints`)
      .then(setEndpoints)
      .catch(() => {});
  }, [project.id]);

  const endpoint = endpoints?.find((e) => e.serviceName === service.name);

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

function EnvironmentTab({ applicationId, deploymentId }: { applicationId: string; deploymentId: string }) {
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

  return (
    <div>
      {error && <Alert variant="error">{error}</Alert>}
      {!credentials && !error && <Skeleton className="h-24" />}
      {credentials && entries.length === 0 && <p className="text-sm text-slate-400">Este serviço não gerou segredos.</p>}
      {entries.length > 0 && (
        <div>
          <div className="mb-3 flex justify-end">
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
    </div>
  );
}

const DOMAIN_TONE: Record<string, StatusTone> = {
  ACTIVE: 'success',
  PENDING: 'info',
  ERROR: 'danger',
};

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
  const [showForm, setShowForm] = useState(false);
  const [hostname, setHostname] = useState('');
  const [port, setPort] = useState<number | null>(null);
  const [createDnsRecord, setCreateDnsRecord] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<EndpointServiceInfo[]>(`/applications/${project.id}/endpoints`)
      .then((list) => {
        setEndpoints(list);
        const endpoint = list.find((e) => e.serviceName === service.name);
        const recommended = endpoint?.ports.find((p) => p.recommended) ?? endpoint?.ports[0];
        if (recommended) setPort(recommended.port);
      })
      .catch(() => {});
  }, [project.id, service.name]);

  const domains = project.domains.filter((d) => d.serviceName === service.name);
  const endpoint = endpoints?.find((e) => e.serviceName === service.name);

  async function create() {
    if (!hostname.trim() || !port) return;
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/applications/${project.id}/domains`, {
        method: 'POST',
        body: JSON.stringify({ hostname: hostname.trim(), serviceName: service.name, port, createDnsRecord }),
      });
      setShowForm(false);
      setHostname('');
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao criar domínio');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {domains.length === 0 ? (
        <p className="text-sm text-slate-400">Nenhum domínio associado a este serviço.</p>
      ) : (
        <div className="card divide-y divide-slate-100 overflow-hidden dark:divide-slate-700">
          {domains.map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="flex items-center gap-2">
                <StatusBadge tone={DOMAIN_TONE[d.status] ?? 'neutral'}>{d.hostname}</StatusBadge>
              </div>
              {d.status === 'ACTIVE' && (
                <a href={`https://${d.hostname}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-indigo-500 hover:underline">
                  Abrir <IconExternalLink className="h-3 w-3" aria-hidden />
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      {!showForm ? (
        <button onClick={() => setShowForm(true)} className="btn-secondary flex items-center gap-1.5 px-3.5 py-2 text-sm">
          <IconPlus className="h-4 w-4" aria-hidden />
          Adicionar domínio
        </button>
      ) : (
        <div className="card space-y-3 p-4">
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-slate-700 dark:text-slate-200">Domínio</span>
            <input value={hostname} onChange={(e) => setHostname(e.target.value)} placeholder="app.seudominio.com" className="input" />
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
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={createDnsRecord} onChange={(e) => setCreateDnsRecord(e.target.checked)} />
            Criar registro DNS na Cloudflare automaticamente
          </label>
          {error && <Alert variant="error">{error}</Alert>}
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowForm(false)} className="btn-secondary px-3.5 py-2 text-sm">
              Cancelar
            </button>
            <button onClick={create} disabled={saving || !hostname.trim() || !port} className="btn-primary px-3.5 py-2 text-sm disabled:opacity-50">
              {saving ? 'Criando...' : 'Criar'}
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
        <div key={i} className="flex items-start gap-3 px-4 py-3">
          <StatusBadge tone={RISK_TONE[risk.level]}>{risk.level}</StatusBadge>
          <p className="text-sm text-slate-700 dark:text-slate-200">{risk.message}</p>
        </div>
      ))}
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-slate-400">{label}</span>
      <span className="truncate text-right text-slate-700 dark:text-slate-200">{value}</span>
    </div>
  );
}
