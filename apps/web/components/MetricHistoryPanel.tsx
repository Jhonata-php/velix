'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
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
  { label: '3h', hours: 3 },
  { label: '6h', hours: 6 },
  { label: '24h', hours: 24 },
  { label: '7d', hours: 168 },
];

const METRICS: { key: Metric; label: string; unit: string; colorClass: string }[] = [
  { key: 'load', label: 'Load average', unit: '', colorClass: 'text-violet-500 dark:text-violet-400' },
  { key: 'mem', label: 'Memória', unit: '%', colorClass: 'text-amber-500 dark:text-amber-400' },
  { key: 'disk', label: 'Disco', unit: '%', colorClass: 'text-teal-500 dark:text-teal-400' },
];

function valueOf(sample: Sample, metric: Metric): number | null {
  if (metric === 'load') return sample.loadAvg1;
  if (metric === 'disk') return sample.diskPercent;
  if (sample.memTotalMb && sample.memUsedMb != null) return (sample.memUsedMb / sample.memTotalMb) * 100;
  return null;
}

/** Histórico de métricas do servidor — gráfico grande sempre visível, em vez
 * de escondido atrás de um clique em cada card. Um seletor troca a métrica
 * (Load/Memória/Disco), outro o período (3h/6h/24h/7d); os dois lêem do
 * mesmo endpoint `/servers/:id/metrics/history?hours=N` já existente. */
export function MetricHistoryPanel({ serverId }: { serverId: string }) {
  const [metric, setMetric] = useState<Metric>('load');
  const [hours, setHours] = useState(6);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiFetch<Sample[]>(`/servers/${serverId}/metrics/history?hours=${hours}`)
      .then(setSamples)
      .finally(() => setLoading(false));
  }, [serverId, hours]);

  const active = METRICS.find((m) => m.key === metric)!;
  const values = samples.map((s) => valueOf(s, metric)).filter((v): v is number => v != null);
  const min = values.length ? Math.min(...values) : null;
  const max = values.length ? Math.max(...values) : null;
  const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

  return (
    <div className="card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800/60">
          {METRICS.map((m) => (
            <button
              key={m.key}
              onClick={() => setMetric(m.key)}
              className={`tab-pill ${metric === m.key ? 'tab-pill-active' : ''}`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800/60">
          {RANGES.map((r) => (
            <button
              key={r.label}
              onClick={() => setHours(r.hours)}
              className={`tab-pill ${hours === r.hours ? 'tab-pill-active' : ''}`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center text-sm text-slate-400">Carregando...</div>
      ) : values.length === 0 ? (
        <div className="flex h-64 items-center justify-center text-sm text-slate-400">Sem dados nesse período.</div>
      ) : (
        <>
          <Sparkline data={values} className={`h-64 w-full ${active.colorClass}`} />
          <div className="mt-4 grid grid-cols-3 gap-3 text-center text-sm">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Mínimo</p>
              <p className="mt-1 font-semibold tabular-nums">
                {min!.toFixed(1)}
                {active.unit}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Média</p>
              <p className="mt-1 font-semibold tabular-nums">
                {avg!.toFixed(1)}
                {active.unit}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Máximo</p>
              <p className="mt-1 font-semibold tabular-nums">
                {max!.toFixed(1)}
                {active.unit}
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
