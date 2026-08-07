'use client';

import { useMemo, useState } from 'react';
import { relativeTime } from '@/lib/relativeTime';
import { StatusBadge } from './StatusBadge';
import { IconSearch, IconChevronRight, IconDownload } from './icons';

export interface ReleaseEntry {
  version: string;
  tagName: string;
  publishedAt: string | null;
  url: string;
  changelogHtml: string;
  prerelease: boolean;
  installed: boolean;
  newer: boolean;
}

interface Props {
  releases: ReleaseEntry[];
  onInstall?: (version: string) => void;
  canInstall: boolean;
}

/** Texto puro do changelog, só para a busca casar com o conteúdo e não apenas
 * com o número da versão — quem procura "domínio" quer achar a versão que mexeu
 * em domínio, sem lembrar qual foi. */
function plainText(html: string) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .toLowerCase();
}

/**
 * Histórico de versões publicadas.
 *
 * A tela antiga mostrava só a mais recente, o que respondia "tem atualização?"
 * mas não "o que mudou desde a minha versão" — a pergunta de quem está três
 * versões atrás e precisa decidir se atualiza agora ou depois. Por isso as
 * versões mais novas que a instalada vêm abertas por padrão, e as antigas
 * fechadas: o que interessa é o que ainda falta aplicar.
 */
export function ReleaseList({ releases, onInstall, canInstall }: Props) {
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(releases.filter((r) => r.newer).map((r) => r.version)));

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return releases;
    return releases.filter((r) => r.version.toLowerCase().includes(q) || plainText(r.changelogHtml).includes(q));
  }, [releases, search]);

  function toggle(version: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(version)) next.delete(version);
      else next.add(version);
      return next;
    });
  }

  return (
    <section className="card overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5 dark:border-slate-700">
        <h2 className="section-title">Histórico de versões</h2>
        <div className="relative">
          <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por funcionalidade ou versão..."
            className="input h-8 w-full py-0 pl-8 text-xs sm:w-72"
          />
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-slate-400">Nenhuma versão corresponde à busca.</p>
      ) : (
        <div className="divide-y divide-slate-200 dark:divide-slate-700">
          {visible.map((release, index) => {
            const open = expanded.has(release.version);
            const isNewest = index === 0 && !search.trim();
            return (
              <div key={release.version} className={release.newer ? 'bg-indigo-500/[0.03]' : ''}>
                <div className="flex items-center gap-3 px-5 py-3">
                  <button onClick={() => toggle(release.version)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                    <IconChevronRight
                      className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`}
                      aria-hidden
                    />
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-semibold text-slate-900 dark:text-slate-50">v{release.version}</span>
                        {release.installed && <StatusBadge tone="success">instalada</StatusBadge>}
                        {isNewest && !release.installed && <StatusBadge tone="info">mais recente</StatusBadge>}
                        {release.prerelease && <StatusBadge tone="warning">prévia</StatusBadge>}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-slate-400">
                        {release.publishedAt ? `Publicada ${relativeTime(release.publishedAt)}` : 'Sem data de publicação'}
                      </span>
                    </span>
                  </button>

                  {release.newer && canInstall && onInstall && (
                    <button
                      onClick={() => onInstall(release.version)}
                      className="btn-primary flex shrink-0 items-center gap-1.5 px-3 py-1.5 text-xs"
                    >
                      <IconDownload className="h-3.5 w-3.5" aria-hidden />
                      Instalar
                    </button>
                  )}

                  <a
                    href={release.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hidden shrink-0 text-[11px] text-slate-400 hover:text-indigo-500 sm:block"
                  >
                    GitHub
                  </a>
                </div>

                {open && release.changelogHtml && (
                  <div
                    className="changelog-body border-t border-slate-100 px-5 py-4 pl-11 text-sm leading-relaxed text-slate-600 dark:border-slate-800 dark:text-slate-300"
                    dangerouslySetInnerHTML={{ __html: release.changelogHtml }}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
