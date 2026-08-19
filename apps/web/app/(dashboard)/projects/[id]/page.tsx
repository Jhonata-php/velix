'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { useAutoRefresh } from '@/lib/useAutoRefresh';
import { relativeTime } from '@/lib/relativeTime';
import { Alert } from '@/components/Alert';
import { Breadcrumb } from '@/components/Breadcrumb';
import { EmptyState } from '@/components/EmptyState';
import { Skeleton } from '@/components/Skeleton';
import { StatusBadge, RowStatusLabel, rowStatusBorderClass, type StatusTone } from '@/components/StatusBadge';
import { Modal, ConfirmModal } from '@/components/Modal';
import { GitDeployWizard } from '@/components/GitDeployWizard';
import { ActionMenu, type ActionMenuItem } from '@/components/ActionMenu';
import {
  IconPlus,
  IconGithub,
  IconStore,
  IconServer,
  IconTrash,
  IconLayoutGrid,
  IconChevronRight,
  IconClock,
} from '@/components/icons';
import type { ProjectDetail, ProjectService } from '@/lib/types';

const PROJECT_STATUS_TONE: Record<ProjectDetail['status'], StatusTone> = {
  EMPTY: 'neutral',
  DEPLOYING: 'info',
  RUNNING: 'success',
  STOPPED: 'neutral',
  ERROR: 'danger',
  REMOVING: 'warning',
};

const PROJECT_STATUS_LABEL: Record<ProjectDetail['status'], string> = {
  EMPTY: 'vazio',
  DEPLOYING: 'implantando',
  RUNNING: 'rodando',
  STOPPED: 'parado',
  ERROR: 'com erro',
  REMOVING: 'removendo',
};

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

/**
 * Painel do projeto: a lista de serviços que ele reúne (cada um pode vir de
 * uma origem diferente — catálogo ou Git, ver `deploymentId`) e o ponto de
 * entrada pra adicionar mais um. Clicar num serviço abre a tela dele, com
 * abas (`/projects/[id]/services/[name]`).
 */
export default function ProjectPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAddChooser, setShowAddChooser] = useState(false);
  const [gitWizard, setGitWizard] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);

  function load() {
    apiFetch<ProjectDetail>(`/applications/${params.id}`)
      .then(setProject)
      .catch((e) => setError(e instanceof Error ? e.message : 'Falha ao carregar'));
  }

  useEffect(load, [params.id]);
  useAutoRefresh(load, 15_000);

  async function removeProject() {
    setRemoving(true);
    try {
      await apiFetch(`/applications/${params.id}`, { method: 'DELETE' });
      router.push('/projects');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao remover projeto');
      setRemoving(false);
      setConfirmRemove(false);
    }
  }

  function deploymentFor(service: ProjectService) {
    return project?.deployments.find((d) => d.id === service.deploymentId);
  }

  if (error && !project) {
    return <Alert variant="error">{error}</Alert>;
  }

  if (!project) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24" />
        <Skeleton className="h-16" />
      </div>
    );
  }

  const menuItems: ActionMenuItem[] = [
    { label: 'Remover projeto', icon: <IconTrash className="h-4 w-4" />, onClick: () => setConfirmRemove(true), danger: true },
  ];

  return (
    <div>
      <Breadcrumb items={[{ label: 'Projetos', href: '/projects' }, { label: project.name }]} />

      <div className="card mb-5 flex flex-wrap items-start justify-between gap-3 p-3.5">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 text-base font-semibold text-indigo-600 dark:text-indigo-400">
            {project.name.charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="page-title">{project.name}</h1>
              <StatusBadge tone={PROJECT_STATUS_TONE[project.status]}>{PROJECT_STATUS_LABEL[project.status]}</StatusBadge>
            </div>
            {project.description && <p className="mt-0.5 text-xs text-slate-400">{project.description}</p>}
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
              <Link href={`/servers/${project.server.id}`} className="inline-flex items-center gap-1.5 hover:text-indigo-500">
                <IconServer className="h-3.5 w-3.5" aria-hidden />
                {project.server.isLocal ? 'este servidor' : project.server.name}
              </Link>
              <span className="inline-flex items-center gap-1.5">
                <IconClock className="h-3.5 w-3.5" aria-hidden />
                criado {relativeTime(project.deployedAt)}
              </span>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button onClick={() => setShowAddChooser(true)} className="btn-primary flex items-center gap-1.5 px-3.5 py-2 text-sm">
            <IconPlus className="h-4 w-4" aria-hidden />
            Adicionar serviço
          </button>
          <ActionMenu items={menuItems} />
        </div>
      </div>

      {project.lastError && (
        <div className="mb-4">
          <Alert variant="error">{project.lastError}</Alert>
        </div>
      )}

      {project.services.length === 0 ? (
        <EmptyState
          icon={<IconLayoutGrid className="h-5 w-5" />}
          title="Este projeto ainda não tem nenhum serviço"
          description="Adicione um serviço do catálogo ou implante direto do seu repositório."
          action={
            <button onClick={() => setShowAddChooser(true)} className="btn-primary px-3.5 py-2 text-sm">
              Adicionar serviço
            </button>
          }
        />
      ) : (
        <>
          <p className="section-label mb-2">
            Serviços ({project.services.length})
          </p>
          <div className="card divide-y divide-slate-100 overflow-hidden dark:divide-slate-700">
            {project.services.map((service) => {
              const deployment = deploymentFor(service);
              const fromGit = deployment?.sourceType === 'git';
              return (
                <Link
                  key={service.id}
                  href={`/projects/${project.id}/services/${encodeURIComponent(service.name)}`}
                  className={`group flex items-center gap-3 border-l-[3px] ${rowStatusBorderClass(SERVICE_STATUS_TONE[service.status])} py-3 pl-3.5 pr-4 transition hover:bg-slate-50 dark:hover:bg-slate-800/40`}
                >
                  {fromGit ? (
                    <IconGithub className="h-4.5 w-4.5 shrink-0 text-slate-400" aria-hidden />
                  ) : (
                    <IconStore className="h-4.5 w-4.5 shrink-0 text-slate-400" aria-hidden />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="truncate text-sm font-medium text-slate-900 group-hover:text-indigo-600 dark:text-slate-100 dark:group-hover:text-indigo-400">
                        {service.name}
                      </p>
                      <RowStatusLabel tone={SERVICE_STATUS_TONE[service.status]}>{SERVICE_STATUS_LABEL[service.status]}</RowStatusLabel>
                    </div>
                    <p className="truncate font-mono text-xs text-slate-400">
                      {fromGit
                        ? `${deployment?.repoUrl?.replace('https://', '').replace('.git', '') ?? 'repositório'} · ${deployment?.gitRef ?? ''}`
                        : service.image}
                    </p>
                  </div>
                  <IconChevronRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:text-indigo-400 dark:text-slate-600" aria-hidden />
                </Link>
              );
            })}
          </div>
        </>
      )}

      {showAddChooser && (
        <Modal title="Adicionar serviço" onClose={() => setShowAddChooser(false)} maxWidth="max-w-sm">
          <div className="space-y-2">
            <button
              onClick={() => router.push(`/library?project=${project.id}`)}
              className="card flex w-full items-center gap-3 p-3.5 text-left transition hover:border-indigo-400/50"
            >
              <IconStore className="h-5 w-5 shrink-0 text-indigo-500" aria-hidden />
              <span>
                <span className="block text-sm font-medium text-slate-900 dark:text-slate-100">Do catálogo</span>
                <span className="block text-xs text-slate-400">Escolha um aplicativo pronto da Biblioteca</span>
              </span>
            </button>
            <button
              onClick={() => {
                setShowAddChooser(false);
                setGitWizard(true);
              }}
              className="card flex w-full items-center gap-3 p-3.5 text-left transition hover:border-indigo-400/50"
            >
              <IconGithub className="h-5 w-5 shrink-0 text-slate-700 dark:text-slate-200" aria-hidden />
              <span>
                <span className="block text-sm font-medium text-slate-900 dark:text-slate-100">Do repositório</span>
                <span className="block text-xs text-slate-400">Implante direto do seu código (Dockerfile ou Nixpacks)</span>
              </span>
            </button>
          </div>
        </Modal>
      )}

      {gitWizard && (
        <GitDeployWizard
          applicationId={project.id}
          projectServerId={project.server.id}
          onClose={() => setGitWizard(false)}
          onDeployed={() => {
            setGitWizard(false);
            load();
          }}
        />
      )}

      {confirmRemove && (
        <ConfirmModal
          title="Remover projeto"
          message={`Remover "${project.name}"? Todos os containers e volumes dos serviços deste projeto são apagados. Essa ação não pode ser desfeita.`}
          confirmLabel="Remover"
          danger
          loading={removing}
          onConfirm={removeProject}
          onCancel={() => setConfirmRemove(false)}
        />
      )}
    </div>
  );
}
