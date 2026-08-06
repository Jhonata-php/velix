'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { apiFetch } from './api';

export interface SelfUpdateStatus {
  available: boolean;
  state: 'idle' | 'requested' | 'running' | 'success' | 'error';
  message: string | null;
  requestedBy: string | null;
  fromVersion: string | null;
  updatedAt: string | null;
}

interface SelfUpdateContext {
  /** Verdadeiro enquanto a tela cheia de atualização deve bloquear o painel. */
  active: boolean;
  status: SelfUpdateStatus | null;
  /** Chamado por quem dispara a atualização, pra não esperar o próximo ciclo. */
  start: () => void;
  dismiss: () => void;
}

const Ctx = createContext<SelfUpdateContext>({ active: false, status: null, start: () => {}, dismiss: () => {} });

/** Devagar de propósito: é só a sonda que descobre uma atualização começada em
 * outro lugar. Quem já está vendo a tela cheia tem o próprio laço, bem mais
 * rápido — não faz sentido todo mundo consultar de 3 em 3 segundos o tempo todo. */
const WATCH_MS = 15_000;

/**
 * Uma atualização derruba o painel inteiro, não só a aba de quem clicou. Quem
 * estivesse em Servidores ou na Loja veria requisições falhando sem explicação,
 * então a tela de espera precisa aparecer pra todo usuário logado — a sonda
 * mora no layout, não na página de Atualizações.
 */
export function SelfUpdateProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SelfUpdateStatus | null>(null);
  const [active, setActive] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const next = await apiFetch<SelfUpdateStatus>('/updates/apply/status');
        if (cancelled) return;
        setStatus(next);
        // Só entra sozinho em andamento. "success" e "error" ficam gravados no
        // host depois que tudo acaba: reagir a eles reabriria a tela a cada
        // visita, muito depois da atualização ter terminado.
        if (next.state === 'requested' || next.state === 'running') {
          setActive(true);
          setDismissed(false);
        }
      } catch {
        // A API some no meio do rebuild — esperado. Quem já está com a tela
        // aberta continua com ela; quem não está, não deve abrir por causa de
        // uma falha de rede qualquer.
      }
    }

    poll();
    const timer = setInterval(poll, WATCH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <Ctx.Provider
      value={{
        active: active && !dismissed,
        status,
        start: () => {
          setActive(true);
          setDismissed(false);
        },
        dismiss: () => setDismissed(true),
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useSelfUpdate() {
  return useContext(Ctx);
}
