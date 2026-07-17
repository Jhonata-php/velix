'use client';

import { useRouter } from 'next/navigation';
import type { CatalogApplicationSummary } from '@/lib/types';
import { CATEGORY_LABEL } from '@/lib/catalogCategories';
import { AppIcon } from './AppIcon';
import { StatusBadge } from './StatusBadge';

interface Props {
  app: CatalogApplicationSummary;
  serverId?: string;
  /** Quando fornecido, "Instalar" chama isso (abre o assistente em modal, sem navegar)
   * em vez de ir pra página de detalhes com `?install=1`. */
  onInstall?: (slug: string) => void;
  installLoading?: boolean;
}

/** Linha compacta de app-store — logo + nome + descrição curta + categoria +
 * botão de ação, tudo numa faixa horizontal (~110px de altura). A linha
 * inteira abre os detalhes; o botão tem sua própria ação (não propaga o clique). */
export function CompactAppCard({ app, serverId, onInstall, installLoading }: Props) {
  const router = useRouter();
  const installed = app.installed[0];
  const blocked = app.riskLevel === 'blocked';

  function openDetail() {
    router.push(`/library/${app.slug}${serverId ? `?server=${serverId}` : ''}`);
  }

  function primaryAction(e: React.MouseEvent) {
    e.stopPropagation();
    if (installed) {
      if (installed.hostname) window.open(`https://${installed.hostname}`, '_blank', 'noreferrer');
      else router.push(`/servers/${installed.serverId}?tab=applications`);
    } else if (onInstall) {
      onInstall(app.slug);
    } else {
      router.push(`/library/${app.slug}?install=1${serverId ? `&server=${serverId}` : ''}`);
    }
  }

  return (
    <div
      onClick={openDetail}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && openDetail()}
      className="card flex cursor-pointer items-center gap-3 p-3 transition hover:border-indigo-400/60 hover:bg-slate-50 dark:hover:bg-slate-800/40"
    >
      <AppIcon icon={app.icon} name={app.name} size="md" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-[15px] font-semibold text-slate-900 dark:text-slate-100">{app.name}</p>
          {installed && <StatusBadge tone="success">instalado</StatusBadge>}
        </div>
        <p className="line-clamp-2 text-[12.5px] leading-snug text-slate-500">{app.description}</p>
        <p className="mt-0.5 truncate text-[11px] text-slate-400">{CATEGORY_LABEL[app.category] ?? app.category}</p>
      </div>
      <button
        onClick={primaryAction}
        disabled={blocked || installLoading}
        className="h-8 shrink-0 rounded-lg bg-indigo-500 px-3 text-xs font-medium text-white transition hover:bg-indigo-600 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {blocked ? 'Bloqueado' : installLoading ? 'Abrindo...' : installed ? 'Abrir' : 'Instalar'}
      </button>
    </div>
  );
}
