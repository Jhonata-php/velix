'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import type { CatalogApplicationDetail } from '@/lib/types';
import { CATEGORY_LABEL } from '@/lib/catalogCategories';
import { AppIcon } from './AppIcon';
import { Alert } from './Alert';
import { Skeleton } from './Skeleton';
import { StatusBadge } from './StatusBadge';
import { IconX, IconGithub, IconLink, IconFileText, IconLayers, IconHardDrive, IconGlobe, IconShield } from './icons';

interface Props {
  slug: string;
  onClose: () => void;
  onInstall: (slug: string) => void;
  onOpenInstalled?: (info: CatalogApplicationDetail['installed'][number]) => void;
}

/** Ampliação de uma captura. Sem biblioteca de lightbox: é uma imagem numa
 * camada por cima, com fechar no clique e no Esc. */
function Lightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div onClick={onClose} className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-6 backdrop-blur-sm">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} className="max-h-full max-w-full rounded-lg shadow-2xl" />
    </div>
  );
}

/**
 * Detalhes do aplicativo antes de instalar: o que é, quem faz, onde mora o
 * projeto e como ele se parece. Antes disso o único caminho era a página de
 * detalhes, que tirava o usuário da vitrine e perdia a rolagem e os filtros.
 *
 * As capturas vêm dos próprios projetos (README, site oficial) e são opcionais
 * — a seção só existe quando o manifesto declara URLs de verdade. Imagem
 * inventada ou adivinhada quebraria na cara do usuário, então nenhuma é
 * gerada por convenção de nome.
 */
export function AppDetailModal({ slug, onClose, onInstall, onOpenInstalled }: Props) {
  const [app, setApp] = useState<CatalogApplicationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);
  const [brokenShots, setBrokenShots] = useState<Set<string>>(new Set());

  useEffect(() => {
    apiFetch<CatalogApplicationDetail>(`/catalog/applications/${slug}`)
      .then(setApp)
      .catch((e) => setError(e instanceof Error ? e.message : 'Falha ao carregar'));
  }, [slug]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !zoom) onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, zoom]);

  const installed = app?.installed[0];
  const blocked = app?.riskLevel === 'blocked';
  const shots = (app?.screenshots ?? []).filter((s) => !brokenShots.has(s));

  return (
    <>
      <div className="overlay-fade fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-slate-950/50 p-4 backdrop-blur-md sm:items-center">
        <div className="modal-pop card flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden p-0">
          {!app ? (
            <div className="p-6">
              {error ? <Alert variant="error">{error}</Alert> : <Skeleton className="h-48" />}
            </div>
          ) : (
            <>
              <div className="flex items-start gap-4 border-b border-slate-200 p-5 dark:border-slate-700">
                <AppIcon icon={app.icon} name={app.name} size="lg" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-50">{app.name}</h2>
                    {app.trending && <StatusBadge tone="warning">em alta</StatusBadge>}
                    {installed && <StatusBadge tone="success">instalado</StatusBadge>}
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-slate-500">{app.description}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
                    <span>{CATEGORY_LABEL[app.category] ?? app.category}</span>
                    <span>v{app.version}</span>
                    <span>
                      {app.servicesCount} {app.servicesCount === 1 ? 'serviço' : 'serviços'}
                    </span>
                    <span>mín. {app.minResources.memoryMb} MB de RAM</span>
                  </div>
                </div>
                <button onClick={onClose} aria-label="Fechar" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
                  <IconX className="h-4 w-4" />
                </button>
              </div>

              <div className="flex-1 space-y-5 overflow-y-auto p-5">
                {shots.length > 0 && (
                  <div className="no-scrollbar -mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
                    {shots.map((src) => (
                      <button
                        key={src}
                        onClick={() => setZoom(src)}
                        className="shrink-0 overflow-hidden rounded-xl border border-slate-200 transition hover:border-indigo-400 dark:border-slate-700"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={src}
                          alt={`Captura de tela do ${app.name}`}
                          loading="lazy"
                          onError={() => setBrokenShots((prev) => new Set(prev).add(src))}
                          className="h-44 w-auto max-w-[22rem] object-cover"
                        />
                      </button>
                    ))}
                  </div>
                )}

                {(app.repositoryUrl || app.websiteUrl || app.documentationUrl) && (
                  <div className="flex flex-wrap gap-2">
                    {app.repositoryUrl && (
                      <LinkChip href={app.repositoryUrl} icon={<IconGithub className="h-3.5 w-3.5" />} label="Repositório" />
                    )}
                    {app.websiteUrl && <LinkChip href={app.websiteUrl} icon={<IconLink className="h-3.5 w-3.5" />} label="Site oficial" />}
                    {app.documentationUrl && app.documentationUrl !== app.repositoryUrl && (
                      <LinkChip href={app.documentationUrl} icon={<IconFileText className="h-3.5 w-3.5" />} label="Documentação" />
                    )}
                  </div>
                )}

                <div className="grid gap-3 sm:grid-cols-2">
                  <InfoCard icon={<IconLayers className="h-4 w-4" />} title="Componentes">
                    {app.services.map((s) => (
                      <div key={s.name} className="flex items-center justify-between gap-2">
                        <span className="truncate text-slate-600 dark:text-slate-300">
                          {s.name}
                          {s.optional && <span className="ml-1 text-[10px] text-slate-400">opcional</span>}
                        </span>
                        <code className="shrink-0 truncate font-mono text-[11px] text-slate-400">{s.image}</code>
                      </div>
                    ))}
                  </InfoCard>

                  <InfoCard icon={<IconGlobe className="h-4 w-4" />} title="Acesso">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-500">Serviço principal</span>
                      <span className="text-slate-700 dark:text-slate-200">{app.primaryService}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-500">Porta</span>
                      <span className="text-slate-700 dark:text-slate-200">{app.primaryPort}</span>
                    </div>
                    {app.secretKeys.length > 0 && (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-slate-500">Senhas geradas</span>
                        <span className="text-slate-700 dark:text-slate-200">{app.secretKeys.length}</span>
                      </div>
                    )}
                  </InfoCard>

                  {app.services.some((s) => s.volumes.length > 0) && (
                    <InfoCard icon={<IconHardDrive className="h-4 w-4" />} title="Dados persistidos">
                      {app.services.flatMap((s) =>
                        s.volumes.map((v) => (
                          <div key={`${s.name}-${v.name}`} className="flex items-center justify-between gap-2">
                            <span className="truncate text-slate-600 dark:text-slate-300">{v.name}</span>
                            <code className="shrink-0 truncate font-mono text-[11px] text-slate-400">{v.containerPath}</code>
                          </div>
                        )),
                      )}
                    </InfoCard>
                  )}

                  {app.securityFindings.length > 0 && (
                    <InfoCard icon={<IconShield className="h-4 w-4" />} title="Segurança">
                      {app.securityFindings.map((f, i) => (
                        <p key={i} className="text-slate-500">
                          {f.message}
                        </p>
                      ))}
                    </InfoCard>
                  )}
                </div>

                {installed && (
                  <Alert variant="info">
                    Já instalado em <strong>{installed.serverName}</strong>
                    {installed.hostname ? ` — ${installed.hostname}` : ''}.
                  </Alert>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3.5 dark:border-slate-700">
                <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
                  Fechar
                </button>
                {installed && onOpenInstalled ? (
                  <button onClick={() => onOpenInstalled(installed)} className="btn-primary px-4 py-2 text-sm">
                    Abrir
                  </button>
                ) : (
                  <button onClick={() => onInstall(app.slug)} disabled={blocked} className="btn-primary px-4 py-2 text-sm disabled:opacity-50">
                    {blocked ? 'Bloqueado por segurança' : 'Instalar'}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {zoom && <Lightbox src={zoom} alt={app?.name ?? ''} onClose={() => setZoom(null)} />}
    </>
  );
}

function LinkChip({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 transition hover:border-indigo-400 hover:text-indigo-600 dark:border-slate-700 dark:text-slate-300 dark:hover:text-indigo-400"
    >
      {icon}
      {label}
    </a>
  );
}

function InfoCard({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200">
        <span className="text-indigo-500">{icon}</span>
        {title}
      </p>
      <div className="space-y-1 text-xs">{children}</div>
    </div>
  );
}
