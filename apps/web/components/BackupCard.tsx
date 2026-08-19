'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { relativeTime } from '@/lib/relativeTime';
import { Alert } from './Alert';
import { StatusBadge, RowStatusLabel, rowStatusBorderClass } from './StatusBadge';
import { IconHardDrive, IconRefresh } from './icons';

interface BackupRun {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: 'RUNNING' | 'SUCCESS' | 'ERROR';
  trigger: string;
  fileName: string | null;
  sizeBytes: number | null;
  error: string | null;
}

interface BackupInfo {
  available: boolean;
  directory: string;
  scheduledAt: string;
  retentionDays: number;
  runs: BackupRun[];
}

function formatSize(bytes: number | null) {
  if (!bytes) return '—';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Backup do banco e do .env.
 *
 * O histórico é a parte que importa: um backup agendado que parou de rodar não
 * avisa ninguém — só a ausência de execuções recentes conta essa história. Por
 * isso a última execução aparece em destaque, e não escondida numa lista.
 */
export function BackupCard() {
  const [info, setInfo] = useState<BackupInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [scheduledAt, setScheduledAt] = useState('03:15');
  const [retentionDays, setRetentionDays] = useState(14);
  const [saving, setSaving] = useState(false);

  function load() {
    apiFetch<BackupInfo>('/backups')
      .then((i) => {
        setInfo(i);
        setScheduledAt(i.scheduledAt);
        setRetentionDays(i.retentionDays);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Falha ao carregar'));
  }
  useEffect(load, []);

  async function runNow() {
    setRunning(true);
    setError(null);
    try {
      await apiFetch('/backups/run', { method: 'POST' });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao executar');
    } finally {
      setRunning(false);
    }
  }

  async function saveSchedule() {
    if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 365) {
      setError('Retenção precisa ser um número inteiro entre 1 e 365 dias.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiFetch('/backups/config', { method: 'PATCH', body: JSON.stringify({ scheduledAt, retentionDays }) });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar agendamento');
    } finally {
      setSaving(false);
    }
  }

  const last = info?.runs[0];
  const lastSuccess = info?.runs.find((r) => r.status === 'SUCCESS');
  // Mais de dois dias sem sucesso com agendamento diário significa que algo
  // parou — vale gritar, não esperar o usuário reparar sozinho.
  const stale = lastSuccess ? Date.now() - new Date(lastSuccess.startedAt).getTime() > 2 * 86400_000 : true;

  return (
    <section className="card p-5">
      <div className="flex items-start gap-3">
        <span className="icon-chip bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
          <IconHardDrive className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="section-title">Backup automático</h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Banco de dados e <code>.env</code> todo dia às {info?.scheduledAt ?? '03:15'}, mantidos por {info?.retentionDays ?? 14} dias.
          </p>
        </div>
        {info?.available && (
          <button onClick={runNow} disabled={running} className="btn-secondary flex shrink-0 items-center gap-1.5 px-3 py-1.5 text-xs">
            <IconRefresh className={`h-3.5 w-3.5 ${running ? 'animate-spin' : ''}`} aria-hidden />
            {running ? 'Executando...' : 'Fazer agora'}
          </button>
        )}
      </div>

      {error && (
        <div className="mt-3">
          <Alert variant="error">{error}</Alert>
        </div>
      )}

      {info && !info.available && (
        <div className="mt-3">
          <Alert variant="warning">
            Indisponível nesta instalação — o diretório do Velix não está montado na API. Rode o instalador novamente.
          </Alert>
        </div>
      )}

      {info?.available && (
        <>
          <div className="mt-4 grid grid-cols-1 gap-3 rounded-lg border border-slate-200 p-3 text-sm sm:grid-cols-2 dark:border-slate-700">
            <label className="block">
              <span className="mb-1 block text-xs text-slate-400">Horário diário</span>
              <input type="time" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className="input h-9" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-slate-400">Retenção (dias)</span>
              <input
                type="number"
                min={1}
                max={365}
                value={retentionDays}
                onChange={(e) => setRetentionDays(Number(e.target.value))}
                className="input h-9"
              />
            </label>
          </div>
          <div className="mt-2 flex justify-end">
            <button onClick={saveSchedule} disabled={saving} className="btn-secondary px-3.5 py-2 text-sm disabled:opacity-50">
              {saving ? 'Salvando...' : 'Salvar agendamento'}
            </button>
          </div>

          {stale && (
            <div className="mt-3">
              <Alert variant="warning" title="Nenhum backup recente">
                {lastSuccess
                  ? `O último com sucesso foi ${relativeTime(lastSuccess.startedAt)}. Verifique se o agendamento está rodando.`
                  : 'Nenhum backup foi concluído ainda. Use "Fazer agora" para testar.'}
              </Alert>
            </div>
          )}

          {last && (
            <div className="mt-4 flex items-center gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
                  Último backup · {relativeTime(last.startedAt)}
                </p>
                <p className="truncate text-xs text-slate-400">
                  {last.error ?? `${formatSize(last.sizeBytes)} · ${last.trigger === 'manual' ? 'manual' : 'agendado'}`}
                </p>
              </div>
              <StatusBadge tone={last.status === 'SUCCESS' ? 'success' : last.status === 'ERROR' ? 'danger' : 'info'}>
                {last.status === 'SUCCESS' ? 'concluído' : last.status === 'ERROR' ? 'falhou' : 'rodando'}
              </StatusBadge>
            </div>
          )}

          <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
            Os arquivos ficam em <code>{info.directory}</code>, no host. Isso protege contra engano e falha de container,
            mas <strong>não contra perda do disco</strong> — copie para fora do servidor periodicamente.
          </p>

          {info.runs.length > 1 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-slate-500">Histórico ({info.runs.length})</summary>
              <div className="mt-2 space-y-1">
                {info.runs.map((r) => {
                  const tone = r.status === 'SUCCESS' ? 'success' : r.status === 'ERROR' ? 'danger' : 'info';
                  return (
                    <div key={r.id} className={`flex items-center justify-between gap-2 border-l-[3px] ${rowStatusBorderClass(tone)} pl-2 text-xs`}>
                      <span className="truncate text-slate-400">
                        {new Date(r.startedAt).toLocaleString('pt-BR')} · {formatSize(r.sizeBytes)}
                      </span>
                      <RowStatusLabel tone={tone}>{r.status === 'SUCCESS' ? 'ok' : r.status === 'ERROR' ? 'falhou' : 'rodando'}</RowStatusLabel>
                    </div>
                  );
                })}
              </div>
            </details>
          )}
        </>
      )}
    </section>
  );
}
