'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/api';
import type { CatalogApplicationSummary } from '@/lib/types';
import { CATEGORY_LABEL } from '@/lib/catalogCategories';
import { CompactAppCard } from '@/components/CompactAppCard';
import { DeployWizard } from '@/components/DeployWizard';
import { EmptyState } from '@/components/EmptyState';
import { Skeleton } from '@/components/Skeleton';
import { Toolbar } from '@/components/Toolbar';
import { IconSearch } from '@/components/icons';
import { useInstallWizard } from '@/lib/useInstallWizard';

type TrustFilter = 'all' | 'trending' | 'official' | 'community' | 'installed';

const TRUST_TABS: { key: TrustFilter; label: string }[] = [
  { key: 'all', label: 'Todos' },
  { key: 'trending', label: 'Em alta' },
  { key: 'official', label: 'Oficiais' },
  { key: 'community', label: 'Comunidade' },
  { key: 'installed', label: 'Instalados' },
];

type SortKey = 'name' | 'category';

export default function LibraryPage() {
  const [apps, setApps] = useState<CatalogApplicationSummary[] | null>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [trust, setTrust] = useState<TrustFilter>('all');
  const [sort, setSort] = useState<SortKey>('name');
  const wizard = useInstallWizard();

  useEffect(() => {
    apiFetch<CatalogApplicationSummary[]>('/catalog/applications').then(setApps);
  }, []);

  const categories = useMemo(() => Array.from(new Set((apps ?? []).map((a) => a.category))).sort(), [apps]);

  const visible = useMemo(() => {
    let list = apps ?? [];
    if (category) list = list.filter((a) => a.category === category);
    if (trust === 'trending') list = list.filter((a) => a.trending);
    if (trust === 'official') list = list.filter((a) => a.trust === 'official');
    if (trust === 'community') list = list.filter((a) => a.trust !== 'official');
    if (trust === 'installed') list = list.filter((a) => a.installed.length > 0);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((a) => a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q) || a.category.toLowerCase().includes(q));
    }
    return [...list].sort((a, b) =>
      sort === 'name' ? a.name.localeCompare(b.name) : (CATEGORY_LABEL[a.category] ?? a.category).localeCompare(CATEGORY_LABEL[b.category] ?? b.category),
    );
  }, [apps, category, trust, search, sort]);

  return (
    <div>
      <div className="mb-4">
        <h1 className="page-title">Loja de Aplicativos</h1>
        <p className="text-xs text-slate-400">
          {apps ? `${apps.length} aplicativo${apps.length === 1 ? '' : 's'} no catálogo do Velix` : 'Catálogo do Velix'} — implante com um assistente
          guiado, com variáveis, volumes, domínio e SSL configurados automaticamente.
        </p>
      </div>

      <Toolbar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Buscar aplicativos..."
        resultCount={apps ? `${visible.length} de ${apps.length}` : undefined}
        filters={
          <>
            <div className="flex items-center gap-0.5 rounded-md border border-slate-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-800">
              {TRUST_TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTrust(t.key)}
                  className={`rounded px-2 py-1 text-[11px] font-medium transition ${
                    trust === t.key ? 'bg-indigo-500 text-white' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="input h-8 w-auto py-0 text-xs">
              <option value="">Todas as categorias</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c] ?? c}
                </option>
              ))}
            </select>
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="input h-8 w-auto py-0 text-xs">
              <option value="name">Ordenar: Nome</option>
              <option value="category">Ordenar: Categoria</option>
            </select>
          </>
        }
      />

      {apps === null ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-[104px]" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<IconSearch className="h-5 w-5" />}
          title={search || category || trust !== 'all' ? 'Nenhum aplicativo corresponde ao filtro' : 'Catálogo vazio'}
          action={
            search || category || trust !== 'all' ? (
              <button
                onClick={() => {
                  setSearch('');
                  setCategory('');
                  setTrust('all');
                }}
                className="btn-secondary px-3 py-1.5 text-xs"
              >
                Limpar filtros
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visible.map((app) => (
            <CompactAppCard key={app.slug} app={app} onInstall={wizard.open} installLoading={wizard.loadingSlug === app.slug} />
          ))}
        </div>
      )}

      {wizard.target && <DeployWizard manifest={wizard.target} onClose={wizard.close} />}
    </div>
  );
}
