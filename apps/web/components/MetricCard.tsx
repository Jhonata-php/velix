import type { ReactNode } from 'react';

export function MetricCard({
  icon,
  label,
  chipClassName = 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
  onClick,
  children,
}: {
  icon: ReactNode;
  label: string;
  chipClassName?: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <div className={`card flex flex-col gap-2.5 p-3.5 ${onClick ? 'card-hover cursor-pointer' : ''}`} onClick={onClick}>
      <div className="flex items-center gap-2">
        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${chipClassName}`}>{icon}</span>
        <span className="truncate text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</span>
      </div>
      {children}
    </div>
  );
}

export function MetricValue({ children }: { children: ReactNode }) {
  return <p className="truncate text-xl font-bold tracking-tight">{children}</p>;
}
