'use client';

import type { ReactNode } from 'react';

export interface ContextNavItem {
  key: string;
  label: string;
  icon: ReactNode;
}

export interface ContextNavGroup {
  label: string;
  items: ContextNavItem[];
}

/** Nav contextual em rail, agrupada por seção — integrada ao layout (sem virar
 * um card isolado), sticky no desktop, faixa horizontal com scroll no mobile. */
export function ContextNav({
  groups,
  active,
  onSelect,
}: {
  groups: ContextNavGroup[];
  active: string;
  onSelect: (key: string) => void;
}) {
  return (
    <>
      <nav className="hidden will-change-transform md:sticky md:top-[72px] md:block md:w-[216px] md:shrink-0 md:self-start">
        <div className="flex flex-col gap-5">
          {groups.map((group) => (
            <div key={group.label}>
              <p className="section-label mb-1.5 px-3">{group.label}</p>
              <div className="flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const isActive = active === item.key;
                  return (
                    <button
                      key={item.key}
                      onClick={() => onSelect(item.key)}
                      className={`focus-ring group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition ${
                        isActive
                          ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400'
                          : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-200'
                      }`}
                    >
                      {isActive && <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-indigo-500" />}
                      <span className="shrink-0 [&>svg]:h-[18px] [&>svg]:w-[18px]">{item.icon}</span>
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </nav>

      <nav className="flex gap-1 overflow-x-auto pb-1 md:hidden">
        {groups.flatMap((g) => g.items).map((item) => {
          const isActive = active === item.key;
          return (
            <button
              key={item.key}
              onClick={() => onSelect(item.key)}
              className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition ${
                isActive
                  ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400'
                  : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800/60'
              }`}
            >
              <span className="shrink-0 [&>svg]:h-4 [&>svg]:w-4">{item.icon}</span>
              {item.label}
            </button>
          );
        })}
      </nav>
    </>
  );
}
