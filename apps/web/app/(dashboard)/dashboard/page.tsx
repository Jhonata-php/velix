'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { useAutoRefresh } from '@/lib/useAutoRefresh';
import { Bar } from '@/components/Bar';
import { Sparkline } from '@/components/Sparkline';
import { IconServer, IconActivity, IconX } from '@/components/icons';

interface ServerMetrics {
  uptimeText: string | null;
  loadAvg: [number, number, number] | null;
  memTotalMb: number | null;
  memUsedMb: number | null;
  diskPercent: string | null;
}

interface Server {
  id: string;
  name: string;
  status: 'PENDING' | 'ONLINE' | 'OFFLINE' | 'ERROR';
  metrics: ServerMetrics | null;
}

const STATUS_DOT: Record<Server['status'], string> = {
  ONLINE: 'bg-green-500',
  OFFLINE: 'bg-slate-400',
  ERROR: 'bg-red-500',
  PENDING: 'bg-amber-400',
};

const STATUS_TEXT: Record<Server['status'], string> = {
  ONLINE: 'text-green-500 dark:text-green-400',
  OFFLINE: 'text-slate-400 dark:text-slate-500',
  ERROR: 'text-red-500 dark:text-red-400',
  PENDING: 'text-amber-500 dark:text-amber-400',
};

export default function DashboardPage() {
  const [servers, setServers] = useState<Server[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  // ponytail: histórico só em memória (últimos ~5min via polling de 10s), reseta
  // ao recarregar a página — mesma abordagem já usada no detalhe do servidor,
  // sem precisar de série temporal persistida no backend.
  const [avgLoadHistory, setAvgLoadHistory] = useState<number[]>([]);
  const [memHistory, setMemHistory] = useState<Record<string, number[]>>({});

  function load() {
    setRefreshing(true);
    apiFetch<Server[]>('/servers')
      .then((data) => {
        setServers(data);

        const loads = data.map((s) => s.metrics?.loadAvg?.[0]).filter((v): v is number => v != null);
        if (loads.length > 0) {
          const avg = loads.reduce((a, b) => a + b, 0) / loads.length;
          setAvgLoadHistory((h) => [...h.slice(-29), avg]);
        }

        setMemHistory((prev) => {
          const next = { ...prev };
          for (const s of data) {
            if (s.metrics?.memTotalMb && s.metrics.memUsedMb != null) {
              const pct = (s.metrics.memUsedMb / s.metrics.memTotalMb) * 100;
              next[s.id] = [...(prev[s.id] ?? []).slice(-19), pct];
            }
          }
          return next;
        });
      })
      .catch(() => setServers([]))
      .finally(() => setRefreshing(false));
  }

  useEffect(load, []);
  useAutoRefresh(load, 10_000);

  const online = servers.filter((s) => s.status === 'ONLINE').length;
  const needsAttention = servers.length - online;

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Visão geral</h1>
        <button onClick={load} className="btn-secondary px-3 py-1.5 text-xs">
          {refreshing ? 'Atualizando...' : '↻ Atualizar agora'}
        </button>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-[1.6fr_1fr]">
        <div className="card card-hover p-5">
          <div className="icon-chip mb-3 bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400">
            <IconActivity className="h-5 w-5" />
          </div>
          <p className="text-sm text-slate-500">Carga média · tempo real</p>
          <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">{servers.length} servidores</p>
          <Sparkline data={avgLoadHistory} className="mt-3 h-16 w-full text-indigo-500 dark:text-indigo-400" />
        </div>

        <div className="grid grid-rows-2 gap-4">
          <div className="card card-hover p-4">
            <div className="icon-chip mb-2 h-8 w-8 bg-green-50 text-green-600 dark:bg-green-500/10 dark:text-green-400">
              <IconActivity className="h-4 w-4" />
            </div>
            <p className="text-sm text-slate-500">Online</p>
            <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{online}</p>
          </div>
          <div className="card card-hover p-4">
            <div className="icon-chip mb-2 h-8 w-8 bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400">
              <IconX className="h-4 w-4" />
            </div>
            <p className="text-sm text-slate-500">Precisa de atenção</p>
            <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{needsAttention}</p>
          </div>
        </div>
      </div>

      <p className="mb-3 text-sm font-medium text-slate-500">Servidores</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {servers.map((s) => {
          const memPercent = s.metrics?.memTotalMb ? ((s.metrics.memUsedMb ?? 0) / s.metrics.memTotalMb) * 100 : null;
          const diskPercent = s.metrics?.diskPercent ? Number(s.metrics.diskPercent.replace('%', '')) : null;
          return (
            <Link key={s.id} href={`/servers/${s.id}`} className="card card-hover block p-4">
              <div className="mb-3 flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                  <IconServer className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[s.status]}`} />
              </div>

              <Sparkline data={memHistory[s.id] ?? []} className={`mb-3 h-8 w-full ${STATUS_TEXT[s.status]}`} />

              <div className="space-y-1.5 text-xs text-slate-500">
                <div className="flex items-center gap-2">
                  <span className="w-10 shrink-0">Mem</span>
                  {memPercent !== null ? (
                    <>
                      <Bar percent={memPercent} />
                      <span className="shrink-0">{memPercent.toFixed(0)}%</span>
                    </>
                  ) : (
                    <span>—</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-10 shrink-0">Disco</span>
                  {diskPercent !== null ? (
                    <>
                      <Bar percent={diskPercent} />
                      <span className="shrink-0">{s.metrics?.diskPercent}</span>
                    </>
                  ) : (
                    <span>—</span>
                  )}
                </div>
              </div>
            </Link>
          );
        })}
        {servers.length === 0 && (
          <div className="card col-span-full px-4 py-10 text-center text-slate-400">Nenhum servidor cadastrado ainda.</div>
        )}
      </div>
    </div>
  );
}
