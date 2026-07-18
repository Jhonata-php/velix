'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { Alert } from '@/components/Alert';
import { IconRefresh, IconDownload, IconCheck, IconClock } from '@/components/icons';

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

interface HistoryEntry {
  id: string;
  checkedAt: string;
  installedVersion: string;
  latestVersion: string | null;
  channel: string;
  updateAvailable: boolean;
  releaseUrl: string | null;
  error: string | null;
}

const CHANNEL_LABEL: Record<string, string> = { stable: 'Stable', beta: 'Beta', nightly: 'Nightly' };

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'agora mesmo';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours}h`;
  const days = Math.floor(hours / 24);
  return `há ${days}d`;
}

export default function UpdatesPage() {
  const [current, setCurrent] = useState<VersionInfo | null>(null);
  const [status, setStatus] = useState<UpdateCheckSummary | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [checking, setChecking] = useState(false);

  function loadCurrent() {
    apiFetch<VersionInfo>('/updates/current').then(setCurrent).catch(() => {});
  }

  function loadHistory() {
    apiFetch<HistoryEntry[]>('/updates/history?limit=10').then(setHistory).catch(() => {});
  }

  function loadLatest() {
    apiFetch<UpdateCheckSummary>('/updates/latest').then(setStatus).catch(() => {});
  }

  useEffect(() => {
    loadCurrent();
    loadLatest();
    loadHistory();
  }, []);

  async function handleCheck() {
    setChecking(true);
    try {
      const result = await apiFetch<UpdateCheckSummary>('/updates/check', { method: 'POST' });
      setStatus(result);
      loadHistory();
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className="page-title">Atualizações</h1>
        <p className="text-xs text-slate-400">Versão instalada e releases publicadas no GitHub</p>
      </div>

      <section className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="section-title">Versão instalada</h2>
          <button
            onClick={handleCheck}
            disabled={checking}
            className="btn-secondary flex items-center gap-1.5 px-3 py-1.5 text-xs"
          >
            <IconRefresh className={`h-3.5 w-3.5 ${checking ? 'animate-spin' : ''}`} />
            Verificar novamente
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-slate-400">Versão</p>
            <p className="text-sm font-medium">v{current?.version ?? '—'}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-slate-400">Canal</p>
            <p className="text-sm font-medium">{CHANNEL_LABEL[status?.channel ?? 'stable']}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-slate-400">Commit</p>
            <p className="truncate text-sm font-medium">{current?.commit ?? '—'}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-slate-400">Node</p>
            <p className="text-sm font-medium">{current?.nodeVersion ?? '—'}</p>
          </div>
        </div>
      </section>

      <section className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="section-title">Status</h2>
          {status && (
            <span className="flex items-center gap-1 text-[11px] text-slate-400">
              <IconClock className="h-3 w-3" />
              Última verificação: {relativeTime(status.checkedAt)}
            </span>
          )}
        </div>

        {!status ? (
          <p className="text-sm text-slate-400">Carregando...</p>
        ) : status.error ? (
          <Alert variant="warning" title="Não foi possível consultar novas versões.">
            {status.error}
          </Alert>
        ) : status.updateAvailable && status.release ? (
          <div className="space-y-3">
            <Alert variant="info" title={`Nova versão disponível: v${status.release.version}`}>
              Você está usando v{status.installedVersion}. Publicada{' '}
              {status.release.publishedAt ? relativeTime(status.release.publishedAt) : 'recentemente'}.
            </Alert>
            <div className="flex items-center gap-2">
              <a
                href={status.release.url}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-secondary flex items-center gap-1.5 px-3 py-1.5 text-xs"
              >
                <IconDownload className="h-3.5 w-3.5" />
                Ver changelog completo no GitHub
              </a>
            </div>
            {status.release.changelogHtml && (
              <div
                className="changelog-body rounded-lg border border-slate-200 p-4 text-sm leading-relaxed text-slate-600 dark:border-slate-700 dark:text-slate-300"
                dangerouslySetInnerHTML={{ __html: status.release.changelogHtml }}
              />
            )}
            <p className="text-xs text-slate-400">
              Instalação automatizada de atualizações ainda não está disponível nesta versão do Velix — esta tela
              acompanha a versão mais recente publicada, mas a atualização em si segue manual por enquanto.
            </p>
          </div>
        ) : status.release ? (
          <Alert variant="success" title="O Velix está atualizado.">
            <span className="flex items-center gap-1">
              <IconCheck className="h-3.5 w-3.5" /> v{status.installedVersion} é a versão mais recente do canal {CHANNEL_LABEL[status.channel]}.
            </span>
          </Alert>
        ) : (
          <Alert variant="info" title="Nenhuma release encontrada.">
            Não há releases publicadas no canal {CHANNEL_LABEL[status.channel]} deste repositório ainda.
          </Alert>
        )}
      </section>

      <section className="card p-4">
        <h2 className="section-title mb-3">Histórico de verificações</h2>
        {history.length === 0 ? (
          <p className="text-sm text-slate-400">Nenhuma verificação registrada ainda.</p>
        ) : (
          <div className="space-y-2">
            {history.map((h) => (
              <div
                key={h.id}
                className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-xs dark:border-slate-700"
              >
                <div className="min-w-0">
                  <p className="font-medium text-slate-600 dark:text-slate-300">
                    {h.error ? 'Falha na verificação' : h.updateAvailable ? `Atualização encontrada (v${h.latestVersion})` : 'Sem novidades'}
                  </p>
                  <p className="truncate text-slate-400">
                    {new Date(h.checkedAt).toLocaleString('pt-BR')} · canal {CHANNEL_LABEL[h.channel] ?? h.channel} · instalada v{h.installedVersion}
                  </p>
                </div>
                {h.releaseUrl && (
                  <a href={h.releaseUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 text-indigo-500 hover:underline">
                    Ver release
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
