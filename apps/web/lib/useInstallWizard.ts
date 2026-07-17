'use client';

import { useState } from 'react';
import { apiFetch } from './api';
import type { CatalogApplicationDetail } from './types';

/** Abre o assistente de instalação sem navegar pra outra página — busca o
 * manifesto completo sob demanda (o grid só tem o resumo) e guarda como
 * alvo do modal. Compartilhado entre a Biblioteca global e a aba por servidor. */
export function useInstallWizard() {
  const [target, setTarget] = useState<CatalogApplicationDetail | null>(null);
  const [loadingSlug, setLoadingSlug] = useState<string | null>(null);

  async function open(slug: string) {
    setLoadingSlug(slug);
    try {
      const detail = await apiFetch<CatalogApplicationDetail>(`/catalog/applications/${slug}`);
      setTarget(detail);
    } finally {
      setLoadingSlug(null);
    }
  }

  function close() {
    setTarget(null);
  }

  return { target, loadingSlug, open, close };
}
