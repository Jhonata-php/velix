'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { useAutoRefresh } from '@/lib/useAutoRefresh';
import { Alert } from '@/components/Alert';
import { Breadcrumb } from '@/components/Breadcrumb';
import { EmptyState } from '@/components/EmptyState';
import { Skeleton } from '@/components/Skeleton';
import { StatusBadge, type StatusTone } from '@/components/StatusBadge';
import { Modal, ConfirmModal } from '@/components/Modal';
import { GitDeployWizard } from '@/components/GitDeployWizard';
import { IconPlus, IconGithub, IconStore, IconServer, IconTrash, IconLayoutGrid } from '@/components/icons';
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

  return (
    <div>
      <Breadcrumb items={[{ label: 'Projetos', href: '/projects' }, { label: project.name }]} />

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="page-title">{project.name}</h1>
            <StatusBadge tone={PROJECT_STATUS_TONE[project.status]}>{PROJECT_STATUS_LABEL[project.status]}</StatusBadge>
          </div>
          {project.description && <p className="mt-0.5 text-xs text-slate-400">{project.description}</p>}
          <Link
            href={`/servers/${project.server.id}`}
            className="mt-1 inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-indigo-500"
          >
            <IconServer className="h-3.5 w-3.5" aria-hidden />
            {project.server.isLocal ? 'este servidor' : project.server.name}
          </Link>
          {project.lastError && (
            <div className="mt-2">
              <Alert variant="error">{project.lastError}</Alert>
            </div>
          )}
        </div>
        <button onClick={() => setShowAddChooser(true)} className="btn-primary flex shrink-0 items-center gap-1.5 px-3.5 py-2 text-sm">
          <IconPlus className="h-4 w-4" aria-hidden />
          Adicionar serviço
        </button>
      </div>

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
        <div className="card divide-y divide-slate-100 overflow-hidden dark:divide-slate-700">
          {project.services.map((service) => {
            const deployment = deploymentFor(service);
            const fromGit = deployment?.sourceType === 'git';
            return (
              <Link
                key={service.id}
                href={`/projects/${project.id}/services/${encodeURIComponent(service.name)}`}
                className="group flex items-center gap-3 px-4 py-3 transition hover:bg-slate-50 dark:hover:bg-slate-800/40"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-800">
                  {fromGit ? <IconGithub className="h-4.5 w-4.5" aria-hidden /> : <IconStore className="h-4.5 w-4.5" aria-hidden />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-sm font-medium text-slate-900 group-hover:text-indigo-600 dark:text-slate-100 dark:group-hover:text-indigo-400">
                      {service.name}
                    </p>
                    <StatusBadge tone={SERVICE_STATUS_TONE[service.status]}>{SERVICE_STATUS_LABEL[service.status]}</StatusBadge>
                  </div>
                  <p className="truncate text-xs text-slate-400">
                    {fromGit
                      ? `${deployment?.repoUrl?.replace('https://', '').replace('.git', '') ?? 'repositório'} · ${deployment?.gitRef ?? ''}`
                      : service.image}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <div className="mt-8 border-t border-slate-200 pt-4 dark:border-slate-700">
        <button
          onClick={() => setConfirmRemove(true)}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-red-500 transition hover:bg-red-500/10"
        >
          <IconTrash className="h-3.5 w-3.5" aria-hidden />
          Remover projeto
        </button>
      </div>

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
