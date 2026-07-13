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
    { label: 'Servidores totais', value: servers.length, accent: 'bg-indigo-500' },
    { label: 'Online', value: online, accent: 'bg-green-500' },
    { label: 'Offline / erro', value: offline, accent: 'bg-red-500' },
    { label: 'Pendentes', value: pending, accent: 'bg-amber-500' },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {cards.map((c) => (
        <div key={c.label} className="card relative overflow-hidden p-4">
          <div className={`absolute inset-y-0 left-0 w-1 ${c.accent}`} />
          <p className="text-sm text-slate-500">{c.label}</p>
          <p className="mt-1 text-2xl font-semibold">{c.value}</p>
        </div>
      ))}
    </div>
  );
}
