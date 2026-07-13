'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { useAutoRefresh } from '@/lib/useAutoRefresh';
import { Bar } from '@/components/Bar';

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

export default function DashboardPage() {
  const [servers, setServers] = useState<Server[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  function load() {
    setRefreshing(true);
    apiFetch<Server[]>('/servers')
      .then(setServers)
      .catch(() => setServers([]))
      .finally(() => setRefreshing(false));
  }

  useEffect(load, []);
  useAutoRefresh(load, 10_000);

  const online = servers.filter((s) => s.status === 'ONLINE').length;
  const offline = servers.filter((s) => s.status === 'OFFLINE' || s.status === 'ERROR').length;
  const pending = servers.filter((s) => s.status === 'PENDING').length;

  const cards = [
    { label: 'Servidores totais', value: servers.length, accent: 'bg-indigo-500' },
    { label: 'Online', value: online, accent: 'bg-green-500' },
    { label: 'Offline / erro', value: offline, accent: 'bg-red-500' },
    { label: 'Pendentes', value: pending, accent: 'bg-amber-500' },
  ];

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <button onClick={load} className="btn-secondary px-3 py-1.5 text-xs">
          {refreshing ? 'Atualizando...' : '↻ Atualizar agora'}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="card relative overflow-hidden p-4">
            <div className={`absolute inset-y-0 left-0 w-1 ${c.accent}`} />
            <p className="text-sm text-slate-500">{c.label}</p>
            <p className="mt-1 text-2xl font-semibold">{c.value}</p>
          </div>
        ))}
      </div>

      <div className="card mt-6 overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-500 dark:bg-slate-900">
            <tr>
              <th className="px-4 py-3">Servidor</th>
              <th className="px-4 py-3">Uptime</th>
              <th className="px-4 py-3">Load</th>
              <th className="px-4 py-3">Memória</th>
              <th className="px-4 py-3">Disco</th>
            </tr>
          </thead>
          <tbody>
            {servers.map((s) => {
              const memPercent = s.metrics?.memTotalMb ? ((s.metrics.memUsedMb ?? 0) / s.metrics.memTotalMb) * 100 : null;
              const diskPercent = s.metrics?.diskPercent ? Number(s.metrics.diskPercent.replace('%', '')) : null;
              return (
                <tr key={s.id} className="border-t border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900">
                  <td className="px-4 py-3">
                    <Link href={`/servers/${s.id}`} className="flex items-center gap-2 font-medium hover:underline">
                      <span className={`h-2 w-2 rounded-full ${STATUS_DOT[s.status]}`} />
                      {s.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{s.metrics?.uptimeText ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-500">{s.metrics?.loadAvg ? s.metrics.loadAvg.join(', ') : '—'}</td>
                  <td className="px-4 py-3">
                    {memPercent !== null ? (
                      <div className="flex items-center gap-2">
                        <Bar percent={memPercent} />
                        <span className="text-xs text-slate-500">{memPercent.toFixed(0)}%</span>
                      </div>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {diskPercent !== null ? (
                      <div className="flex items-center gap-2">
                        <Bar percent={diskPercent} />
                        <span className="text-xs text-slate-500">{s.metrics?.diskPercent}</span>
                      </div>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {servers.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                  Nenhum servidor cadastrado ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
