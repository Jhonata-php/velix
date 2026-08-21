'use client';

import { useEffect, useState } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import type { CatalogApplicationDetail } from '@/lib/types';
import { CATEGORY_LABEL } from '@/lib/catalogCategories';
import { AppIcon } from '@/components/AppIcon';
import { Breadcrumb } from '@/components/Breadcrumb';
import { Skeleton } from '@/components/Skeleton';
import { StatusBadge, rowStatusBorderClass } from '@/components/StatusBadge';
import { DeployWizard } from '@/components/DeployWizard';
import { IconLayers, IconGlobe, IconHardDrive, IconShield, IconFileText } from '@/components/icons';

const RISK_TONE = { low: 'success', medium: 'warning', high: 'danger', blocked: 'danger' } as const;

type Tab = 'overview' | 'services' | 'variables' | 'volumes' | 'ports' | 'security';

const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: 'overview', label: 'Visão geral', icon: <IconFileText className="h-4 w-4" /> },
  { key: 'services', label: 'Serviços', icon: <IconLayers className="h-4 w-4" /> },
  { key: 'variables', label: 'Variáveis', icon: <IconFileText className="h-4 w-4" /> },
  { key: 'volumes', label: 'Volumes', icon: <IconHardDrive className="h-4 w-4" /> },
  { key: 'ports', label: 'Portas', icon: <IconGlobe className="h-4 w-4" /> },
  { key: 'security', label: 'Segurança', icon: <IconShield className="h-4 w-4" /> },
];

export default function LibraryAppDetailPage() {
  const params = useParams<{ slug: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const preselectedServerId = searchParams.get('server') ?? undefined;
  const autoInstall = searchParams.get('install') === '1';

  const [app, setApp] = useState<CatalogApplicationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [showWizard, setShowWizard] = useState(false);

  useEffect(() => {
    apiFetch<CatalogApplicationDetail>(`/catalog/applications/${params.slug}`)
      .then(setApp)
      .catch((e) => setError(e.message));
  }, [params.slug]);

  useEffect(() => {
    if (app && autoInstall && app.riskLevel !== 'blocked' && app.validation.ok && app.installed.length === 0) {
      setShowWizard(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app, autoInstall]);

  if (error) {
    return (
      <div>
        <Breadcrumb items={[{ label: 'Biblioteca', href: '/library' }, { label: params.slug }]} />
        <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>
      </div>
    );
  }

  if (!app) {
    return (
      <div>
        <Breadcrumb items={[{ label: 'Biblioteca', href: '/library' }, { label: params.slug }]} />
        <Skeleton className="mt-4 h-32" />
        <Skeleton className="mt-3 h-64" />
      </div>
    );
  }

  const canInstall = app.riskLevel !== 'blocked' && app.validation.ok;
  const installed = app.installed[0];

  function openInstalled() {
    if (!installed) return;
    if (installed.hostname) window.open(`https://${installed.hostname}`, '_blank', 'noreferrer');
    else router.push(`/projects/${installed.applicationId}`);
  }

  return (
    <div>
      <Breadcrumb items={[{ label: 'Biblioteca', href: '/library' }, { label: app.name }]} />

      <div className="card mb-4 flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          <AppIcon icon={app.icon} name={app.name} size="lg" />
          <div className="min-w-0">
            <h1 className="page-title">{app.name}</h1>
            <p className="mt-1 max-w-xl text-sm text-slate-500">{app.description}</p>
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <span className="badge bg-indigo-500/10 text-[10px] text-indigo-600 dark:text-indigo-400">VELIX OFFICIAL</span>
              <span className="badge bg-slate-500/10 text-[10px] text-slate-600 dark:text-slate-300">{CATEGORY_LABEL[app.category] ?? app.category}</span>
              <span className="badge bg-slate-500/10 text-[10px] text-slate-600 dark:text-slate-300">v{app.version}</span>
              <span className="badge bg-slate-500/10 text-[10px] text-slate-600 dark:text-slate-300">{app.author}</span>
              {app.riskLevel !== 'low' && <StatusBadge tone={RISK_TONE[app.riskLevel]}>risco {app.riskLevel}</StatusBadge>}
              {installed && <StatusBadge tone="success">instalado em {installed.serverName}</StatusBadge>}
            </div>
            {app.documentationUrl && (
              <a href={app.documentationUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs text-indigo-600 hover:underline dark:text-indigo-400">
                Documentação oficial →
              </a>
            )}
          </div>
        </div>
        {installed ? (
          <button onClick={openInstalled} className="btn-primary shrink-0 px-5 py-2.5 text-sm">
            Abrir
          </button>
        ) : (
          <button onClick={() => setShowWizard(true)} disabled={!canInstall} className="btn-primary shrink-0 px-5 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-50">
            Instalar
          </button>
        )}
      </div>

      {!canInstall && (
        <div className="card mb-4 border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
          {app.riskLevel === 'blocked' ? 'Esta aplicação foi bloqueada pela análise de segurança.' : app.validation.errors.join('; ')}
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-1 border-b border-slate-200 dark:border-slate-700">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`tab-pill flex items-center gap-1.5 ${tab === t.key ? 'border-b-2 border-indigo-500 text-indigo-600 dark:text-indigo-400' : ''}`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab app={app} />}
      {tab === 'services' && <ServicesTab app={app} />}
      {tab === 'variables' && <VariablesTab app={app} />}
      {tab === 'volumes' && <VolumesTab app={app} />}
      {tab === 'ports' && <PortsTab app={app} />}
      {tab === 'security' && <SecurityTab app={app} />}

      {showWizard && <DeployWizard manifest={app} preselectedServerId={preselectedServerId} onClose={() => setShowWizard(false)} />}
    </div>
  );
}

function InfoGrid({ items }: { items: { label: string; value: React.ReactNode }[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {items.map((item) => (
        <div key={item.label} className="card p-3">
          <p className="section-label">{item.label}</p>
          <p className="mt-1 text-sm text-slate-800 dark:text-slate-100">{item.value}</p>
        </div>
      ))}
    </div>
  );
}

function OverviewTab({ app }: { app: CatalogApplicationDetail }) {
  return (
    <InfoGrid
      items={[
        { label: 'Serviços', value: `${app.services.length}` },
        { label: 'Serviço principal', value: app.primaryService },
        { label: 'Porta recomendada', value: `${app.primaryPort}` },
        { label: 'Memória mínima', value: `${app.minResources.memoryMb} MB` },
        { label: 'Segredos gerados automaticamente', value: app.secretKeys.length > 0 ? app.secretKeys.join(', ') : 'Nenhum' },
        { label: 'Suporte a domínio (Traefik + SSL)', value: 'Sim' },
      ]}
    />
  );
}

function ServicesTab({ app }: { app: CatalogApplicationDetail }) {
  return (
    <div className="card divide-y divide-slate-100 overflow-hidden dark:divide-slate-700">
      {app.services.map((s) => (
        <div key={s.name} className="p-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{s.name}</p>
            {s.name === app.primaryService && <span className="badge bg-indigo-500/10 text-[10px] text-indigo-600 dark:text-indigo-400">principal</span>}
            <span className={`badge text-[10px] ${s.optional ? 'bg-slate-500/10 text-slate-500' : 'bg-green-500/10 text-green-600 dark:text-green-400'}`}>
              {s.optional ? 'opcional' : 'obrigatório'}
            </span>
          </div>
          <p className="mt-0.5 truncate text-xs text-slate-400">{s.image}</p>
          <p className="mt-1.5 text-[11px] text-slate-400">
            {s.ports.length} porta{s.ports.length === 1 ? '' : 's'} · {s.volumes.length} volume{s.volumes.length === 1 ? '' : 's'} ·{' '}
            {s.variables.length} variáve{s.variables.length === 1 ? 'l' : 'is'}
          </p>
        </div>
      ))}
    </div>
  );
}

function VariablesTab({ app }: { app: CatalogApplicationDetail }) {
  const allVars = app.services.flatMap((s) => s.variables.map((v) => ({ ...v, service: s.name })));
  return (
    <div className="space-y-3">
      {allVars.length === 0 && app.secretKeys.length === 0 && <p className="text-sm text-slate-400">Esta aplicação não possui variáveis configuráveis.</p>}
      {allVars.length > 0 && (
        <div className="card divide-y divide-slate-100 overflow-hidden dark:divide-slate-700">
          {allVars.map((v) => (
            <div key={`${v.service}-${v.key}`} className="flex items-center justify-between gap-3 p-3.5">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{v.label}</p>
                <p className="truncate text-xs text-slate-400">
                  {v.key} · serviço {v.service} {v.description ? `· ${v.description}` : ''}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <span className="badge bg-slate-500/10 text-[10px] text-slate-600 dark:text-slate-300">{v.type}</span>
                {v.required && <StatusBadge tone="warning">obrigatória</StatusBadge>}
                {v.default !== undefined && <span className="text-xs text-slate-400">padrão: {v.default}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
      {app.secretKeys.length > 0 && (
        <div>
          <p className="section-label mb-1.5">Secrets (geradas automaticamente no deploy)</p>
          <div className="flex flex-wrap gap-1.5">
            {app.secretKeys.map((k) => (
              <span key={k} className="badge bg-amber-500/10 text-[10px] text-amber-600 dark:text-amber-400">
                {k} — valor nunca exibido aqui
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function VolumesTab({ app }: { app: CatalogApplicationDetail }) {
  const allVolumes = app.services.flatMap((s) => s.volumes.map((v) => ({ ...v, service: s.name })));
  if (allVolumes.length === 0) return <p className="text-sm text-slate-400">Esta aplicação não usa armazenamento persistente.</p>;
  return (
    <div className="card divide-y divide-slate-100 overflow-hidden dark:divide-slate-700">
      {allVolumes.map((v) => (
        <div key={`${v.service}-${v.name}`} className="flex items-center justify-between gap-3 p-3.5">
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{v.name}</p>
            <p className="truncate text-xs text-slate-400">serviço {v.service}</p>
          </div>
          <span className="shrink-0 font-mono text-xs text-slate-500">{v.containerPath}</span>
        </div>
      ))}
    </div>
  );
}

function PortsTab({ app }: { app: CatalogApplicationDetail }) {
  const allPorts = app.services.flatMap((s) => s.ports.map((p) => ({ ...p, service: s.name })));
  if (allPorts.length === 0) return <p className="text-sm text-slate-400">Esta aplicação não expõe portas.</p>;
  return (
    <div className="card divide-y divide-slate-100 overflow-hidden dark:divide-slate-700">
      {allPorts.map((p) => (
        <div key={`${p.service}-${p.port}`} className="flex items-center justify-between gap-3 p-3.5">
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
              {p.port}/{p.protocol ?? 'tcp'}
            </p>
            <p className="truncate text-xs text-slate-400">serviço {p.service}</p>
          </div>
          {p.recommended && <StatusBadge tone="success">recomendada para domínio</StatusBadge>}
        </div>
      ))}
    </div>
  );
}

function SecurityTab({ app }: { app: CatalogApplicationDetail }) {
  if (app.securityFindings.length === 0) return <p className="text-sm text-slate-400">Nenhum risco de segurança encontrado nesta aplicação.</p>;
  return (
    <div className="card divide-y divide-slate-100 overflow-hidden dark:divide-slate-700">
      {app.securityFindings.map((f, i) => (
        <div key={i} className={`flex items-center justify-between gap-3 border-l-[3px] ${rowStatusBorderClass(RISK_TONE[f.level])} py-3 pl-3 pr-3.5`}>
          <p className="text-sm text-slate-700 dark:text-slate-200">{f.message}</p>
        </div>
      ))}
    </div>
  );
}
