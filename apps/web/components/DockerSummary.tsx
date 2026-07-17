import { MetricCard, MetricValue } from './MetricCard';
import { IconBox, IconActivity, IconX, IconLayoutGrid } from './icons';
import type { DockerContainer } from '@/lib/containerGroups';

/** Resumo operacional antes da lista — só métricas que existem de verdade hoje
 * (versão do engine + contagens derivadas da lista real de containers). Sem
 * imagens/volumes/CPU/memória: a API não expõe `docker images`/`docker stats`. */
export function DockerSummary({ version, containers }: { version?: string; containers: DockerContainer[] }) {
  const active = containers.filter((c) => c.status.toLowerCase().includes('up')).length;
  const stopped = containers.length - active;

  return (
    <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
      <MetricCard icon={<IconBox className="h-3.5 w-3.5" />} label="Docker Engine" chipClassName="bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400">
        <MetricValue>{version ?? '—'}</MetricValue>
        <p className="mt-0.5 text-[11px] text-slate-400">Daemon saudável</p>
      </MetricCard>
      <MetricCard icon={<IconActivity className="h-3.5 w-3.5" />} label="Ativos" chipClassName="bg-green-50 text-green-600 dark:bg-green-500/10 dark:text-green-400">
        <MetricValue>{active}</MetricValue>
        <p className="mt-0.5 text-[11px] text-slate-400">containers rodando</p>
      </MetricCard>
      <MetricCard icon={<IconX className="h-3.5 w-3.5" />} label="Parados" chipClassName="bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
        <MetricValue>{stopped}</MetricValue>
        <p className="mt-0.5 text-[11px] text-slate-400">containers parados</p>
      </MetricCard>
      <MetricCard icon={<IconLayoutGrid className="h-3.5 w-3.5" />} label="Total" chipClassName="bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-400">
        <MetricValue>{containers.length}</MetricValue>
        <p className="mt-0.5 text-[11px] text-slate-400">no servidor</p>
      </MetricCard>
    </div>
  );
}
