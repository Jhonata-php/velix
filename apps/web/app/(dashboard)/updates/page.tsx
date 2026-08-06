'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { relativeTime } from '@/lib/relativeTime';
import { Alert } from '@/components/Alert';
import { Skeleton } from '@/components/Skeleton';
import { StatusBadge } from '@/components/StatusBadge';
import { UpdateModal } from '@/components/UpdateModal';
import { UpdatingScreen } from '@/components/UpdatingScreen';
import { IconRefresh, IconDownload, IconCheck, IconAlertTriangle } from '@/components/icons';

interface VersionInfo {
  version: string;
  commit: string | null;
  buildDate: string | null;
  nodeVersion: string;
  uptimeSeconds: number;
}

interface ReleaseInfo {
  version: string;
  tagName: string;
  channel: string;
  publishedAt: string | null;
  url: string;
  changelogHtml: string;
  prerelease: boolean;
}

interface UpdateCheckSummary {
  installedVersion: string;
  channel: string;
  updateAvailable: boolean;
  release: ReleaseInfo | null;
  error: string | null;
  checkedAt: string;
}

type TimelineEntry =
  | { id: string; type: 'update'; at: string; fromVersion: string | null; toVersion: string; appliedBy: string }
  | {
      id: string;
      type: 'check';
      at: string;
      installedVersion: string;
      latestVersion: string | null;
      channel: string;
      updateAvailable: boolean;
      releaseUrl: string | null;
      error: string | null;
    };

interface SelfUpdateStatus {
  available: boolean;
  state: 'idle' | 'requested' | 'running' | 'success' | 'error';
  message: string | null;
  requestedBy: string | null;
  fromVersion: string | null;
  updatedAt: string | null;
}

const CHANNEL_LABEL: Record<string, string> = { stable: 'Stable', beta: 'Beta', nightly: 'Nightly' };

function formatUptime(seconds: number) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}min`;
  return `${minutes}min`;
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wider text-slate-400">{label}</p>
      <p className="truncate text-[13px] font-medium text-slate-700 dark:text-slate-200">{value}</p>
    </div>
  );
}

export default function UpdatesPage() {
  const [current, setCurrent] = useState<VersionInfo | null>(null);
  const [status, setStatus] = useState<UpdateCheckSummary | null>(null);
  const [history, setHistory] = useState<TimelineEntry[]>([]);
  const [checking, setChecking] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [selfUpdate, setSelfUpdate] = useState<SelfUpdateStatus | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);

  function loadHistory() {
    apiFetch<TimelineEntry[]>('/updates/history?limit=12').then(setHistory).catch(() => {});
  }

  useEffect(() => {
    apiFetch<VersionInfo>('/updates/current').then(setCurrent).catch(() => {});
    apiFetch<UpdateCheckSummary>('/updates/latest').then(setStatus).catch(() => {});
    loadHistory();

    // Uma atualização em andamento pode ter sido pedida em outra aba, por outro
    // usuário, ou antes de um F5 — a tela de espera tem que reaparecer sozinha.
    apiFetch<SelfUpdateStatus>('/updates/apply/status')
      .then((s) => {
        setSelfUpdate(s);
        if (s.state === 'requested' || s.state === 'running') setUpdating(true);
      })
      .catch(() => {});
  }, []);

  async function handleCheck() {
    setChecking(true);
    try {
      setStatus(await apiFetch<UpdateCheckSummary>('/updates/check', { method: 'POST' }));
      loadHistory();
    } finally {
      setChecking(false);
    }
  }

  async function handleApply() {
    setApplying(true);
    setApplyError(null);
    try {
      await apiFetch('/updates/apply', { method: 'POST' });
      setModalOpen(false);
      setUpdating(true);
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : 'Não foi possível iniciar a atualização.');
    } finally {
      setApplying(false);
    }
  }

  const available = status?.updateAvailable && status.release ? status.release : null;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="page-title">Atualizações</h1>
        <p className="text-xs text-slate-400">Versão instalada e releases publicadas no GitHub</p>
      </div>

      {/* Cartão único com versão, estado e ação — antes eram três cartões
          empilhados que diziam a mesma coisa em três alturas diferentes. */}
      <section className={`card overflow-hidden p-0 ${available ? 'border-indigo-400/60' : ''}`}>
        <div className="flex flex-wrap items-center gap-4 p-5">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-wider text-slate-400">Versão instalada</p>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
                v{current?.version ?? '—'}
              </span>
              <StatusBadge tone="neutral">{CHANNEL_LABEL[status?.channel ?? 'stable']}</StatusBadge>
              {available && <StatusBadge tone="info">atualização disponível</StatusBadge>}
            </div>
            <p className="mt-1 text-xs text-slate-400">
              {!status ? (
                'Consultando o GitHub...'
              ) : status.error ? (
                <span className="flex items-center gap-1 text-amber-500">
                  <IconAlertTriangle className="h-3.5 w-3.5" aria-hidden /> {status.error}
                </span>
              ) : available ? (
                <>
                  v{available.version} publicada {available.publishedAt ? relativeTime(available.publishedAt) : 'recentemente'}
                </>
              ) : status.release ? (
                <span className="flex items-center gap-1 text-green-500">
                  <IconCheck className="h-3.5 w-3.5" aria-hidden /> Esta é a versão mais recente do canal{' '}
                  {CHANNEL_LABEL[status.channel]}
                </span>
              ) : (
                `Nenhuma release publicada no canal ${CHANNEL_LABEL[status.channel]} ainda`
              )}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCheck}
              disabled={checking}
              aria-label="Verificar novamente"
              title="Verificar novamente"
              className="btn-secondary flex h-9 w-9 items-center justify-center p-0"
            >
              <IconRefresh className={`h-4 w-4 ${checking ? 'animate-spin' : ''}`} aria-hidden />
            </button>
            {available && (
              <button onClick={() => setModalOpen(true)} className="btn-primary flex items-center gap-2 px-4 py-2 text-sm">
                <IconDownload className="h-4 w-4" aria-hidden />
                Atualizar para v{available.version}
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 border-t border-slate-200 bg-slate-50/60 px-5 py-3 sm:grid-cols-4 dark:border-slate-700 dark:bg-slate-900/40">
          <Meta label="Commit" value={current?.commit?.slice(0, 7) ?? '—'} />
          <Meta label="Node" value={current?.nodeVersion ?? '—'} />
          {/* uptimeSeconds é o process.uptime() da API (ver VersionService) —
              tempo desde o último restart do container, não do servidor. */}
          <Meta label="API sem reiniciar" value={current ? formatUptime(current.uptimeSeconds) : '—'} />
          <Meta label="Verificado" value={status ? relativeTime(status.checkedAt) : '—'} />
        </div>
      </section>

      {status === null && <Skeleton className="h-24" />}

      {available?.changelogHtml && (
        <section className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="section-title">Novidades da v{available.version}</h2>
            <a href={available.url} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-500 hover:underline">
              Ver no GitHub
            </a>
          </div>
          <div
            className="changelog-body text-sm leading-relaxed text-slate-600 dark:text-slate-300"
            dangerouslySetInnerHTML={{ __html: available.changelogHtml }}
          />
        </section>
      )}

      {status?.error && (
        <Alert variant="warning" title="Não foi possível consultar novas versões.">
          {status.error}
        </Alert>
      )}

      {/* Fechado por padrão: são dezenas de linhas "Sem novidades" idênticas,
          úteis pra diagnosticar mas não pra encarar toda vez que a tela abre. */}
      <details className="card overflow-hidden p-0">
        <summary className="cursor-pointer px-5 py-3 text-sm font-medium text-slate-600 marker:text-slate-400 dark:text-slate-300">
          Histórico de atualizações e verificações
          {history.length > 0 && <span className="ml-1.5 text-xs font-normal text-slate-400">({history.length})</span>}
        </summary>
        <div className="border-t border-slate-200 dark:border-slate-700">
          {history.length === 0 ? (
            <p className="px-5 py-4 text-sm text-slate-400">Nenhuma verificação registrada ainda.</p>
          ) : (
            history.map((h) =>
              h.type === 'update' ? (
                <div
                  key={h.id}
                  className="flex items-center justify-between gap-3 border-b border-slate-100 bg-indigo-500/5 px-5 py-2.5 text-xs last:border-0 dark:border-slate-800"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-slate-700 dark:text-slate-200">
                      {h.fromVersion ? `Atualizado de v${h.fromVersion} para v${h.toVersion}` : `Instalado na v${h.toVersion}`}
                    </p>
                    <p className="truncate text-slate-400">
                      {new Date(h.at).toLocaleString('pt-BR')} · por {h.appliedBy}
                    </p>
                  </div>
                  <StatusBadge tone="success">atualizado</StatusBadge>
                </div>
              ) : (
                <div
                  key={h.id}
                  className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-2 text-xs last:border-0 dark:border-slate-800"
                >
                  <span className="truncate text-slate-500 dark:text-slate-400">
                    {new Date(h.at).toLocaleString('pt-BR')} · v{h.installedVersion} · {CHANNEL_LABEL[h.channel] ?? h.channel}
                  </span>
                  <span className="shrink-0">
                    {h.error ? (
                      <StatusBadge tone="warning">falhou</StatusBadge>
                    ) : h.updateAvailable ? (
                      <StatusBadge tone="info">v{h.latestVersion}</StatusBadge>
                    ) : (
                      <StatusBadge tone="neutral">sem novidades</StatusBadge>
                    )}
                  </span>
                </div>
              ),
            )
          )}
        </div>
      </details>

      {modalOpen && available && current && (
        <UpdateModal
          installedVersion={current.version}
          release={available}
          selfUpdateAvailable={!!selfUpdate?.available}
          applying={applying}
          error={applyError}
          onApply={handleApply}
          onClose={() => setModalOpen(false)}
        />
      )}

      {updating && (
        <UpdatingScreen
          fromVersion={current?.version ?? '—'}
          toVersion={available?.version ?? selfUpdate?.fromVersion ?? '—'}
          onDismiss={() => setUpdating(false)}
        />
      )}
    </div>
  );
}
