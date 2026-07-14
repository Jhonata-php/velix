'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { Modal } from '@/components/Modal';
import { Sparkline } from '@/components/Sparkline';

interface Sample {
  capturedAt: string;
  loadAvg1: number | null;
  memUsedMb: number | null;
  memTotalMb: number | null;
  diskPercent: number | null;
}

type Metric = 'load' | 'mem' | 'disk';

const RANGES: { label: string; hours: number }[] = [
  { label: '1h', hours: 1 },
  { label: '6h', hours: 6 },
  { label: '24h', hours: 24 },
  { label: '7d', hours: 168 },
];

function valueOf(sample: Sample, metric: Metric): number | null {
  if (metric === 'load') return sample.loadAvg1;
  if (metric === 'disk') return sample.diskPercent;
  if (sample.memTotalMb && sample.memUsedMb != null) return (sample.memUsedMb / sample.memTotalMb) * 100;
  return null;
}

export function MetricHistoryModal({
  serverId,
  metric,
  label,
  unit,
  colorClass,
  onClose,
}: {
  serverId: string;
  metric: Metric;
  label: string;
  unit: string;
  colorClass: string;
  onClose: () => void;
}) {
  const [hours, setHours] = useState(1);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiFetch<Sample[]>(`/servers/${serverId}/metrics/history?hours=${hours}`)
      .then(setSamples)
      .finally(() => setLoading(false));
  }, [serverId, hours]);

  const values = samples.map((s) => valueOf(s, metric)).filter((v): v is number => v != null);
  const min = values.length ? Math.min(...values) : null;
  const max = values.length ? Math.max(...values) : null;
  const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

  return (
    <Modal title={label} onClose={onClose} maxWidth="max-w-2xl">
      <div className="mb-4 flex gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800/60">
        {RANGES.map((r) => (
          <button
            key={r.label}
            onClick={() => setHours(r.hours)}
            className={`tab-pill flex-1 ${hours === r.hours ? 'tab-pill-active' : ''}`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex h-56 items-center justify-center text-sm text-slate-400">Carregando...</div>
      ) : values.length === 0 ? (
        <div className="flex h-56 items-center justify-center text-sm text-slate-400">Sem dados nesse período.</div>
      ) : (
        <>
          <Sparkline data={values} className={`h-56 w-full ${colorClass}`} />
          <div className="mt-4 grid grid-cols-3 gap-3 text-center text-sm">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Mínimo</p>
              <p className="mt-1 font-semibold tabular-nums">
                {min!.toFixed(1)}
                {unit}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Média</p>
              <p className="mt-1 font-semibold tabular-nums">
                {avg!.toFixed(1)}
                {unit}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Máximo</p>
              <p className="mt-1 font-semibold tabular-nums">
                {max!.toFixed(1)}
                {unit}
              </p>
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}
