'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { useAutoRefresh } from '@/lib/useAutoRefresh';
import { relativeTime } from '@/lib/relativeTime';
import { Alert } from '@/components/Alert';
import { EmptyState } from '@/components/EmptyState';
import { Skeleton } from '@/components/Skeleton';
import { StatusBadge, type StatusTone } from '@/components/StatusBadge';
import { Toolbar } from '@/components/Toolbar';
import { CreateProjectModal } from '@/components/CreateProjectModal';
import { IconLayoutGrid, IconServer, IconExternalLink, IconPlus } from '@/components/icons';

interface ProjectDomain {
  id: string;
  hostname: string;
  status: string;
}

interface ProjectDeploymentSummary {
  sourceType: string;
  manifestSlug: string | null;
}

interface ProjectRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: 'EMPTY' | 'DEPLOYING' | 'RUNNING' | 'STOPPED' | 'ERROR' | 'REMOVING';
  deployedAt: string;
  lastError: string | null;
  domains: ProjectDomain[];
  deployments: ProjectDeploymentSummary[];
  server: { id: string; name: string; isLocal: boolean };
}

const STATUS_TONE: Record<ProjectRow['status'], StatusTone> = {
  EMPTY: 'neutral',
  DEPLOYING: 'info',
  RUNNING: 'success',
  STOPPED: 'neutral',
  ERROR: 'danger',
  REMOVING: 'warning',
};

const STATUS_LABEL: Record<ProjectRow['status'], string> = {
  EMPTY: 'vazio',
  DEPLOYING: 'implantando',
  RUNNING: 'rodando',
  STOPPED: 'parada',
  ERROR: 'com erro',
  REMOVING: 'removendo',
};

type StatusFilter = 'all' | 'RUNNING' | 'STOPPED' | 'ERROR';

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'Todos' },
  { key: 'RUNNING', label: 'Rodando' },
  { key: 'STOPPED', label: 'Parados' },
  { key: 'ERROR', label: 'Com erro' },
];

/**
 * "O que eu tenho implantado?" só podia ser respondido abrindo servidor por
 * servidor, aba por aba. Esta tela junta tudo num lugar — um projeto por
 * linha, cada um podendo reunir vários serviços de origens diferentes (ver
 * `/projects/[id]`), por isso a listagem não mostra ícone de catálogo por
 * linha como a versão antiga (Aplicações) mostrava: um projeto pode não ter
 * um único "aplicativo" que o represente.
 */
export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [serverId, setServerId] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  function load() {
    apiFetch<ProjectRow[]>('/applications')
      .then(setProjects)
      .catch((e) => setError(e instanceof Error ? e.message : 'Falha ao carregar'));
  }

  useEffect(load, []);
  useAutoRefresh(load, 15_000);

  const servers = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projects ?? []) map.set(p.server.id, p.server.name);
    return Array.from(map, ([id, name]) => ({ id, name }));
  }, [projects]);

  const visible = useMemo(() => {
    let list = projects ?? [];
    if (status !== 'all') list = list.filter((p) => p.status === status);
    if (serverId) list = list.filter((p) => p.server.id === serverId);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q) || p.server.name.toLowerCase().includes(q));
    }
    return list;
  }, [projects, status, serverId, search]);

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="page-title">Projetos</h1>
          <p className="text-xs text-slate-400">
            {projects ? `${projects.length} projeto${projects.length === 1 ? '' : 's'}` : 'Tudo'} em todos os servidores gerenciados pelo Velix
          </p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary flex shrink-0 items-center gap-1.5 px-3.5 py-2 text-sm">
          <IconPlus className="h-4 w-4" aria-hidden />
          Novo projeto
        </button>
      </div>

      <Toolbar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Buscar projetos..."
        resultCount={projects ? `${visible.length} de ${projects.length}` : undefined}
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

      {projects === null ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<IconLayoutGrid className="h-5 w-5" />}
          title={projects.length === 0 ? 'Nenhum projeto ainda' : 'Nenhum projeto corresponde ao filtro'}
          description={projects.length === 0 ? 'Crie um projeto e implante serviços dentro dele — do catálogo ou do seu próprio repositório.' : undefined}
          action={
            projects.length === 0 ? (
              <button onClick={() => setShowCreate(true)} className="btn-primary px-3.5 py-2 text-sm">
                Novo projeto
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="card divide-y divide-slate-200 p-0 dark:divide-slate-700">
          {visible.map((p) => {
            const domain = p.domains.find((d) => d.status === 'ACTIVE') ?? p.domains[0];
            return (
              <Link
                key={p.id}
                href={`/projects/${p.id}`}
                className="group flex items-center gap-3 px-4 py-3 transition hover:bg-slate-50 dark:hover:bg-slate-800/40"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-sm font-semibold text-indigo-600 dark:text-indigo-400">
                  {p.name.charAt(0).toUpperCase()}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-sm font-medium text-slate-900 group-hover:text-indigo-600 dark:text-slate-100 dark:group-hover:text-indigo-400">
                      {p.name}
                    </p>
                    <StatusBadge tone={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status]}</StatusBadge>
                  </div>
                  <p className="truncate text-xs text-slate-400">
                    {p.deployments.length} serviço{p.deployments.length === 1 ? '' : 's'} · criado {relativeTime(p.deployedAt)}
                    {p.lastError ? ` · ${p.lastError}` : ''}
                  </p>
                </div>

                <span className="hidden shrink-0 items-center gap-1.5 text-xs text-slate-400 sm:flex">
                  <IconServer className="h-3.5 w-3.5" aria-hidden />
                  {p.server.isLocal ? 'este servidor' : p.server.name}
                </span>

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
              </Link>
            );
          })}
        </div>
      )}

      {showCreate && (
        <CreateProjectModal
          onClose={() => setShowCreate(false)}
          onCreated={(id) => router.push(`/projects/${id}`)}
        />
      )}
    </div>
  );
}
