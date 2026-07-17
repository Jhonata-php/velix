import type { ReactNode } from 'react';
import { ActionMenu, type ActionMenuItem } from './ActionMenu';

/** Cabeçalho de módulo (Docker, Proxy e domínios, Bancos...) — título + descrição/meta à
 * esquerda, ações à direita, ações perigosas escondidas dentro do menu. */
export function ModuleHeader({
  title,
  description,
  meta,
  actions,
  menu,
}: {
  title: string;
  description?: string;
  meta?: ReactNode;
  actions?: ReactNode;
  menu?: ActionMenuItem[];
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="section-title">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-slate-400">{description}</p>}
        {meta && <p className="mt-1 text-xs text-slate-500">{meta}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {actions}
        {menu && menu.length > 0 && <ActionMenu items={menu} />}
      </div>
    </div>
  );
}
