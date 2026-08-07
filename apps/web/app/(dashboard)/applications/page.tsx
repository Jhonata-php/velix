'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { useAutoRefresh } from '@/lib/useAutoRefresh';
import { relativeTime } from '@/lib/relativeTime';
import { Alert } from '@/components/Alert';
import { AppIcon } from '@/components/AppIcon';
import { EmptyState } from '@/components/EmptyState';
import { Skeleton } from '@/components/Skeleton';
import { StatusBadge, type StatusTone } from '@/components/StatusBadge';
import { Toolbar } from '@/components/Toolbar';
import { InstallLogModal } from '@/components/InstallLogModal';
import { AutoDeployModal } from '@/components/AutoDeployModal';
import { IconLayoutGrid, IconServer, IconExternalLink, IconGithub, IconRefresh, IconSettings } from '@/components/icons';
import type { CatalogApplicationSummary } from '@/lib/types';

interface ApplicationDomain {
  id: string;
  hostname: string;
  status: string;
}

interface ApplicationRow {
  id: string;
  name: string;
  slug: string;
  sourceType?: string;
  repoUrl?: string | null;
  gitRef?: string | null;
  manifestSlug: string;
  manifestVersion: string;
  status: 'DEPLOYING' | 'RUNNING' | 'STOPPED' | 'ERROR' | 'REMOVING';
  deployedAt: string;
  lastError: string | null;
  domains: ApplicationDomain[];
  server: { id: string; name: string; isLocal: boolean };
}

const STATUS_TONE: Record<ApplicationRow['status'], StatusTone> = {
  DEPLOYING: 'info',
  RUNNING: 'success',
  STOPPED: 'neutral',
  ERROR: 'danger',
  REMOVING: 'warning',
};

const STATUS_LABEL: Record<ApplicationRow['status'], string> = {
  DEPLOYING: 'implantando',
  RUNNING: 'rodando',
  STOPPED: 'parada',
  ERROR: 'com erro',
  REMOVING: 'removendo',
};

type StatusFilter = 'all' | 'RUNNING' | 'STOPPED' | 'ERROR';

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'Todas' },
  { key: 'RUNNING', label: 'Rodando' },
  { key: 'STOPPED', label: 'Paradas' },
  { key: 'ERROR', label: 'Com erro' },
];

/**
 * "O que eu tenho instalado?" só podia ser respondido abrindo servidor por
 * servidor, aba por aba. Esta tela junta tudo num lugar.
 *
 * Os ícones vêm do catálogo, casados por `manifestSlug` — a aplicação
 * implantada guarda o slug do manifesto, não a arte. Se o catálogo não tiver o
 * slug (manifesto removido numa versão futura), o AppIcon cai no ícone genérico.
 */
export default function ApplicationsPage() {
  const [apps, setApps] = useState<ApplicationRow[] | null>(null);
  const [catalog, setCatalog] = useState<Map<string, CatalogApplicationSummary>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [serverId, setServerId] = useState('');
  const [redeploying, setRedeploying] = useState<ApplicationRow | null>(null);
  const [autoDeployFor, setAutoDeployFor] = useState<ApplicationRow | null>(null);

  function load() {
    apiFetch<ApplicationRow[]>('/applications')
      .then(setApps)
      .catch((e) => setError(e instanceof Error ? e.message : 'Falha ao carregar'));
  }

  useEffect(() => {
    load();
    apiFetch<CatalogApplicationSummary[]>('/catalog/applications')
      .then((list) => setCatalog(new Map(list.map((a) => [a.slug, a]))))
      .catch(() => {});
  }, []);
  useAutoRefresh(load, 15_000);

  const servers = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of apps ?? []) map.set(a.server.id, a.server.name);
    return Array.from(map, ([id, name]) => ({ id, name }));
  }, [apps]);

  const visible = useMemo(() => {
    let list = apps ?? [];
    if (status !== 'all') list = list.filter((a) => a.status === status);
    if (serverId) list = list.filter((a) => a.server.id === serverId);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((a) => a.name.toLowerCase().includes(q) || a.manifestSlug.includes(q) || a.server.name.toLowerCase().includes(q));
    }
    return list;
  }, [apps, status, serverId, search]);

  return (
    <div>
      <div className="mb-4">
        <h1 className="page-title">Aplicações</h1>
        <p className="text-xs text-slate-400">
          {apps ? `${apps.length} implantada${apps.length === 1 ? '' : 's'}` : 'Tudo'} em todos os servidores gerenciados pelo Velix
        </p>
      </div>

      <Toolbar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Buscar aplicações..."
        resultCount={apps ? `${visible.length} de ${apps.length}` : undefined}
        filters={
          <>
            <div className="flex items-center gap-0.5 rounded-md border border-slate-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-800">
              {STATUS_TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setStatus(t.key)}
                  className={`rounded px-2 py-1 text-[11px] font-medium transition ${
                    status === t.key ? 'bg-indigo-500 text-white' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {servers.length > 1 && (
              <select value={serverId} onChange={(e) => setServerId(e.target.value)} className="input h-8 w-auto py-0 text-xs">
                <option value="">Todos os servidores</option>
                {servers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}
          </>
        }
      />

      {error && (
        <div className="mb-3">
          <Alert variant="error">{error}</Alert>
        </div>
      )}

      {apps === null ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<IconLayoutGrid className="h-5 w-5" />}
          title={apps.length === 0 ? 'Nenhuma aplicação implantada ainda' : 'Nenhuma aplicação corresponde ao filtro'}
          description={
            apps.length === 0
              ? 'Escolha um aplicativo na loja e implante em qualquer servidor — inclusive neste, onde o Velix roda.'
              : undefined
          }
          action={
            apps.length === 0 ? (
              <Link href="/library" className="btn-primary px-3.5 py-2 text-sm">
                Abrir a loja
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="card divide-y divide-slate-200 p-0 dark:divide-slate-700">
          {visible.map((app) => {
            const fromGit = app.sourceType === 'git';
            const manifest = fromGit ? undefined : catalog.get(app.manifestSlug);
            const domain = app.domains.find((d) => d.status === 'ACTIVE') ?? app.domains[0];
            return (
              <div key={app.id} className="group flex items-center gap-3 px-4 py-3 transition hover:bg-slate-50 dark:hover:bg-slate-800/40">
                {fromGit ? (
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-900">
                    <IconGithub className="h-5 w-5" aria-hidden />
                  </span>
                ) : (
                  <AppIcon icon={manifest?.icon} name={app.name} size="sm" />
                )}

                <Link href={`/servers/${app.server.id}?tab=applications`} className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-sm font-medium text-slate-900 group-hover:text-indigo-600 dark:text-slate-100 dark:group-hover:text-indigo-400">
                      {app.name}
                    </p>
                    <StatusBadge tone={STATUS_TONE[app.status]}>{STATUS_LABEL[app.status]}</StatusBadge>
                  </div>
                  <p className="truncate text-xs text-slate-400">
                    {fromGit ? `${app.repoUrl?.replace('https://', '').replace('.git', '') ?? 'repositório'} · ${app.gitRef ?? ''}` : `${app.manifestSlug} v${app.manifestVersion}`} · implantada{' '}
                    {relativeTime(app.deployedAt)}
                    {app.lastError ? ` · ${app.lastError}` : ''}
                  </p>
                </Link>

                <span className="hidden shrink-0 items-center gap-1.5 text-xs text-slate-400 sm:flex">
                  <IconServer className="h-3.5 w-3.5" aria-hidden />
                  {app.server.isLocal ? 'este servidor' : app.server.name}
                </span>

                {fromGit && (
                  <button
                    onClick={() => setAutoDeployFor(app)}
                    title="Configurar autodeploy"
                    aria-label={`Autodeploy de ${app.name}`}
                    className="hidden shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-200 hover:text-slate-700 sm:block dark:hover:bg-slate-700 dark:hover:text-slate-100"
                  >
                    <IconSettings className="h-4 w-4" aria-hidden />
                  </button>
                )}

                {fromGit && (
                  <button
                    onClick={() => setRedeploying(app)}
                    title="Reimplantar a partir do repositório"
                    aria-label={`Reimplantar ${app.name}`}
                    className="hidden shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-200 hover:text-slate-700 sm:block dark:hover:bg-slate-700 dark:hover:text-slate-100"
                  >
                    <IconRefresh className="h-4 w-4" aria-hidden />
                  </button>
                )}

                {domain?.hostname && (
                  <a
                    href={`https://${domain.hostname}`}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="hidden shrink-0 items-center gap-1 text-xs text-indigo-500 hover:underline md:flex"
                  >
                    {domain.hostname}
                    <IconExternalLink className="h-3 w-3" aria-hidden />
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}

      {autoDeployFor && (
        <AutoDeployModal
          applicationId={autoDeployFor.id}
          appName={autoDeployFor.name}
          onClose={() => setAutoDeployFor(null)}
        />
      )}

      {/* Reimplantação manual — continua existindo mesmo com autodeploy ligado,
          pra forçar uma reconstrução sem precisar de um push. */}
      {redeploying && (
        <InstallLogModal
          serverId={redeploying.server.id}
          op="git-redeploy"
          params={{ applicationId: redeploying.id }}
          title={`Reimplantando ${redeploying.name}`}
          onClose={() => setRedeploying(null)}
          onDone={load}
        />
      )}
    </div>
  );
}
