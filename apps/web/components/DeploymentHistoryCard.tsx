'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { relativeTime } from '@/lib/relativeTime';
import type { ProjectDeploymentRun, ProjectDeploymentRunDetail } from '@/lib/types';
import { Alert } from './Alert';
import { Skeleton } from './Skeleton';
import { IconCheckCircle, IconAlertTriangle, IconUser, IconRefresh } from './icons';
import { TerminalModal } from './TerminalChrome';

function formatDuration(startedAt: string, finishedAt: string | null): string {
  if (!finishedAt) return 'em andamento';
  const ms = Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime());
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} segundo${seconds === 1 ? '' : 's'}`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}m ${rest}s`;
}

function runTitle(run: ProjectDeploymentRun): string {
  return run.commitMessage ? `Deploy service: ${run.commitMessage}` : 'Deploy service';
}

const ROW_TONE: Record<ProjectDeploymentRun['status'], string> = {
  SUCCESS: 'bg-green-50/70 dark:bg-green-500/5',
  ERROR: 'bg-red-50/70 dark:bg-red-500/5',
  RUNNING: 'bg-slate-50 dark:bg-slate-800/40',
};

const ICON_CHIP_TONE: Record<ProjectDeploymentRun['status'], string> = {
  SUCCESS: 'bg-green-500/15 text-green-600 dark:text-green-400',
  ERROR: 'bg-red-500/15 text-red-500 dark:text-red-400',
  RUNNING: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
};

/**
 * Histórico de implantação de um serviço — cada clique em "Implantar" (ou
 * push que dispara o autodeploy) vira uma linha aqui, com o log completo
 * disponível em "Visualizar" (`DeploymentLogModal`).
 */
export function DeploymentHistoryCard({
  applicationId,
  deploymentId,
  reloadKey,
}: {
  applicationId: string;
  deploymentId?: string | null;
  /** Muda pra forçar recarregar (ex.: depois que um novo deploy termina). */
  reloadKey?: unknown;
}) {
  const [runs, setRuns] = useState<ProjectDeploymentRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewingRunId, setViewingRunId] = useState<string | null>(null);

  function load() {
    apiFetch<ProjectDeploymentRun[]>(`/applications/${applicationId}/deployment-runs`)
      .then(setRuns)
      .catch((e) => setError(e instanceof Error ? e.message : 'Falha ao carregar histórico'));
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [applicationId, reloadKey]);

  const filtered = deploymentId ? (runs ?? []).filter((r) => r.deploymentId === deploymentId) : runs ?? [];

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-700">
        <p className="section-label">Histórico de Implantação</p>
      </div>

      {error && (
        <div className="p-4">
          <Alert variant="error">{error}</Alert>
        </div>
      )}

      {!error && !runs && (
        <div className="space-y-2 p-4">
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      )}

      {!error && runs && filtered.length === 0 && (
        <p className="p-4 text-sm text-slate-400">Nenhuma implantação registrada ainda.</p>
      )}

      {!error && filtered.length > 0 && (
        <div className="divide-y divide-slate-100 dark:divide-slate-700">
          {filtered.map((run) => (
            <div key={run.id} className={`flex items-center justify-between gap-3 px-4 py-3 ${ROW_TONE[run.status]}`}>
              <div className="flex min-w-0 items-center gap-3">
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${ICON_CHIP_TONE[run.status]}`}>
                  {run.status === 'SUCCESS' && <IconCheckCircle className="h-4 w-4" aria-hidden />}
                  {run.status === 'ERROR' && <IconAlertTriangle className="h-4 w-4" aria-hidden />}
                  {run.status === 'RUNNING' && <IconRefresh className="h-4 w-4 animate-spin" aria-hidden />}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">{runTitle(run)}</p>
                  <p className="flex items-center gap-1.5 truncate text-xs text-slate-400">
                    <span>{formatDuration(run.startedAt, run.finishedAt)}</span>
                    <span>/</span>
                    <span>{relativeTime(run.startedAt)}</span>
                    <span title={run.trigger === 'webhook' ? 'Disparado por webhook' : 'Disparado manualmente'}>
                      <IconUser className="ml-1 h-3 w-3 shrink-0" aria-hidden />
                    </span>
                  </p>
                </div>
              </div>
              <button onClick={() => setViewingRunId(run.id)} className="btn-secondary shrink-0 px-3 py-1.5 text-xs">
                Visualizar
              </button>
            </div>
          ))}
        </div>
      )}

      {viewingRunId && (
        <DeploymentLogModal applicationId={applicationId} runId={viewingRunId} onClose={() => setViewingRunId(null)} />
      )}
    </div>
  );
}

function DeploymentLogModal({ applicationId, runId, onClose }: { applicationId: string; runId: string; onClose: () => void }) {
  const [run, setRun] = useState<ProjectDeploymentRunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<ProjectDeploymentRunDetail>(`/applications/${applicationId}/deployment-runs/${runId}`)
      .then(setRun)
      .catch((e) => setError(e instanceof Error ? e.message : 'Falha ao carregar log'));
  }, [applicationId, runId]);

  return (
    <TerminalModal
      title={run ? runTitle(run) : 'Log da implantação'}
      actions={
        <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-white/5">
          Fechar
        </button>
      }
      bodyClassName="flex h-[50vh] flex-1 flex-col overflow-hidden p-3"
    >
      {error && (
        <div className="p-1">
          <Alert variant="error">{error}</Alert>
        </div>
      )}
      {!error && !run && <p className="p-1 text-sm text-slate-400">Carregando...</p>}
      {!error && run && (
        <pre className="h-full flex-1 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-slate-200">
          {run.log?.trim() || (run.error ?? 'Sem saída registrada para esta implantação.')}
        </pre>
      )}
    </TerminalModal>
  );
}
