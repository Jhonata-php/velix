'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useAutoRefresh } from '@/lib/useAutoRefresh';
import type { ServerSummary } from '@/lib/types';
import { Sparkline } from '@/components/Sparkline';
import { MetricCard, MetricValue } from '@/components/MetricCard';
import { ServerRow } from '@/components/ServerRow';
import { EmptyState } from '@/components/EmptyState';
import { SkeletonRow } from '@/components/Skeleton';
import { UpdateBanner } from '@/components/UpdateBanner';
import { IconServer, IconActivity, IconX, IconInbox, IconRefresh } from '@/components/icons';

export default function DashboardPage() {
  const [servers, setServers] = useState<ServerSummary[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // ponytail: histórico só em memória (últimos ~5min via polling de 10s), reseta
  // ao recarregar a página — mesma abordagem já usada no detalhe do servidor,
  // sem precisar de série temporal persistida no backend.
  const [avgLoadHistory, setAvgLoadHistory] = useState<number[]>([]);

  function load() {
    setRefreshing(true);
    apiFetch<ServerSummary[]>('/servers')
      .then((data) => {
        setServers(data);

        const loads = data.map((s) => s.metrics?.loadAvg?.[0]).filter((v): v is number => v != null);
        if (loads.length > 0) {
          const avg = loads.reduce((a, b) => a + b, 0) / loads.length;
          setAvgLoadHistory((h) => [...h.slice(-29), avg]);
        }
      })
      .catch(() => setServers([]))
      .finally(() => setRefreshing(false));
  }

  useEffect(load, []);
  useAutoRefresh(load, 10_000);

  const online = servers?.filter((s) => s.status === 'ONLINE').length ?? 0;
  const needsAttention = servers ? servers.length - online : 0;
  const avgLoad = avgLoadHistory.length ? avgLoadHistory[avgLoadHistory.length - 1] : null;

  return (
    <div>
      <UpdateBanner />

      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="page-title">Visão geral</h1>
          <p className="text-xs text-slate-400">Infraestrutura monitorada pelo Velix</p>
        </div>
        <button onClick={load} className="btn-secondary flex items-center gap-1.5 px-3 py-1.5 text-xs">
          <IconRefresh className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          Atualizar
        </button>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard icon={<IconServer className="h-3.5 w-3.5" />} label="Servidores" chipClassName="bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
          <MetricValue>{servers ? servers.length : '—'}</MetricValue>
        </MetricCard>

        <MetricCard icon={<IconActivity className="h-3.5 w-3.5" />} label="Online" chipClassName="bg-green-50 text-green-600 dark:bg-green-500/10 dark:text-green-400">
          <MetricValue>{servers ? online : '—'}</MetricValue>
        </MetricCard>

        <MetricCard icon={<IconX className="h-3.5 w-3.5" />} label="Precisa de atenção" chipClassName="bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400">
          <MetricValue>{servers ? needsAttention : '—'}</MetricValue>
        </MetricCard>

        <MetricCard icon={<IconActivity className="h-3.5 w-3.5" />} label="Carga média" chipClassName="bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400">
          <MetricValue>{avgLoad != null ? avgLoad.toFixed(2) : '—'}</MetricValue>
          <Sparkline data={avgLoadHistory} className="mt-1 h-6 w-full text-indigo-500 dark:text-indigo-400" />
        </MetricCard>
      </div>

      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Servidores</p>

      {servers === null ? (
        <div className="card divide-y divide-slate-100 overflow-hidden dark:divide-slate-700">
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </div>
      ) : servers.length === 0 ? (
        <EmptyState
          icon={<IconInbox className="h-5 w-5" />}
          title="Nenhum servidor cadastrado ainda"
          description="Adicione um servidor na aba Servidores para começar a monitorar."
        />
      ) : (
        <div className="card divide-y divide-slate-100 overflow-hidden dark:divide-slate-700">
          {servers.map((s) => (
            <ServerRow key={s.id} server={s} />
          ))}
        </div>
      )}
    </div>
  );
}
