'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

interface Server {
  id: string;
  status: 'PENDING' | 'ONLINE' | 'OFFLINE' | 'ERROR';
}

export default function DashboardPage() {
  const [servers, setServers] = useState<Server[]>([]);

  useEffect(() => {
    apiFetch<Server[]>('/servers').then(setServers).catch(() => setServers([]));
  }, []);

  const online = servers.filter((s) => s.status === 'ONLINE').length;
  const offline = servers.filter((s) => s.status === 'OFFLINE' || s.status === 'ERROR').length;
  const pending = servers.filter((s) => s.status === 'PENDING').length;

  const cards = [
    { label: 'Servidores totais', value: servers.length },
    { label: 'Online', value: online },
    { label: 'Offline / erro', value: offline },
    { label: 'Pendentes', value: pending },
  ];

  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold">Dashboard</h1>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-sm text-slate-500">{c.label}</p>
            <p className="mt-1 text-2xl font-semibold">{c.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
