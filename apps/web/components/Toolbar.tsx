import type { ReactNode } from 'react';
import { IconSearch } from './icons';

/** Barra de ferramentas compacta acima de listas — busca + filtros à esquerda,
 * contagem/ações à direita. Substitui abas soltas ocupando a largura toda. */
export function Toolbar({
  search,
  onSearchChange,
  searchPlaceholder = 'Buscar...',
  filters,
  resultCount,
  right,
}: {
  search?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  filters?: ReactNode;
  resultCount?: string;
  right?: ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 dark:border-slate-700/80 dark:bg-slate-900/40">
      <div className="flex flex-1 flex-wrap items-center gap-2">
        {onSearchChange && (
          <div className="relative">
            <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={searchPlaceholder}
              className="h-8 w-full max-w-[220px] rounded-md border border-slate-200 bg-white pl-8 pr-2.5 text-xs text-slate-900 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/15 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>
        )}
        {filters}
      </div>
      <div className="flex shrink-0 items-center gap-3 text-xs text-slate-400">
        {resultCount}
        {right}
      </div>
    </div>
  );
}
