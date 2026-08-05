'use client';

import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { IconCheck, IconAlertTriangle } from './icons';

interface SelfUpdateStatus {
  available: boolean;
  state: 'idle' | 'requested' | 'running' | 'success' | 'error';
  message: string | null;
  requestedBy: string | null;
  fromVersion: string | null;
  updatedAt: string | null;
}

interface Props {
  fromVersion: string;
  toVersion: string;
  onDismiss: () => void;
}

const POLL_MS = 3000;

const STEPS = ['Pedido enviado ao servidor', 'Baixando a nova versão', 'Reconstruindo e reiniciando os serviços', 'Pronto'];

function stepIndex(status: SelfUpdateStatus | null, unreachable: boolean) {
  if (!status) return unreachable ? 2 : 0;
  if (status.state === 'success') return 3;
  if (status.state === 'requested') return 0;
  if (status.message?.includes('Baixando')) return 1;
  return 2;
}

/**
 * Tela cheia de propósito: o rebuild derruba a API e o painel no meio do
 * caminho, e qualquer coisa que o usuário tentasse fazer durante isso falharia
 * de um jeito confuso. Melhor bloquear e explicar.
 *
 * O laço de consulta precisa tolerar o próprio backend sumindo — é o
 * comportamento esperado, não um erro. Enquanto não responde, mostra
 * "reiniciando"; o arquivo de estado vive no host, então a resposta volta
 * assim que a API sobe de novo.
 */
export function UpdatingScreen({ fromVersion, toVersion, onDismiss }: Props) {
  const [status, setStatus] = useState<SelfUpdateStatus | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const next = await apiFetch<SelfUpdateStatus>('/updates/apply/status');
        if (cancelled) return;
        setStatus(next);
        setUnreachable(false);
      } catch {
        if (!cancelled) setUnreachable(true);
      }
    }

    poll();
    const pollTimer = setInterval(poll, POLL_MS);
    const clockTimer = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)), 1000);
    return () => {
      cancelled = true;
      clearInterval(pollTimer);
      clearInterval(clockTimer);
    };
  }, []);

  const failed = status?.state === 'error';
  const done = status?.state === 'success';
  const active = stepIndex(status, unreachable);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-6 backdrop-blur-xl">
      <div className="w-full max-w-md text-center">
        <div className="relative mx-auto mb-8 flex h-24 w-24 items-center justify-center">
          {!done && !failed && (
            <>
              <span className="absolute inset-0 animate-ping rounded-full bg-indigo-500/20" />
              <span className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-indigo-500 border-r-indigo-500/40" />
            </>
          )}
          <span
            className={`flex h-16 w-16 items-center justify-center rounded-2xl text-2xl font-bold text-white shadow-lg ${
              failed ? 'bg-red-500' : done ? 'bg-green-500' : 'animate-logo-glow bg-gradient-to-br from-indigo-500 to-indigo-700'
            }`}
          >
            {failed ? <IconAlertTriangle className="h-7 w-7" /> : done ? <IconCheck className="h-7 w-7" /> : 'V'}
          </span>
        </div>

        <h2 className="text-xl font-semibold text-white">
          {failed ? 'A atualização falhou' : done ? `Atualizado para v${toVersion}` : 'Atualizando o Velix'}
        </h2>
        <p className="mt-1.5 text-sm text-slate-400">
          {failed
            ? status?.message ?? 'Veja .velix-update.log no diretório de instalação.'
            : done
              ? 'Recarregue o painel para usar a nova versão.'
              : `v${fromVersion} → v${toVersion} · não feche nem use o painel até terminar`}
        </p>

        <ol className="mx-auto mt-7 max-w-xs space-y-2.5 text-left">
          {STEPS.map((label, i) => {
            const state = failed && i === active ? 'failed' : i < active || done ? 'done' : i === active ? 'current' : 'todo';
            return (
              <li key={label} className="flex items-center gap-2.5 text-sm">
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] ${
                    state === 'failed'
                      ? 'bg-red-500 text-white'
                      : state === 'done'
                        ? 'bg-green-500 text-white'
                        : state === 'current'
                          ? 'border-2 border-indigo-400 text-indigo-300'
                          : 'border border-slate-600 text-slate-600'
                  }`}
                >
                  {state === 'done' ? <IconCheck className="h-3 w-3" /> : state === 'failed' ? '!' : i + 1}
                </span>
                <span className={state === 'todo' ? 'text-slate-500' : state === 'current' ? 'text-slate-100' : 'text-slate-400'}>
                  {label}
                </span>
              </li>
            );
          })}
        </ol>

        {!done && !failed && (
          <p className="mt-6 text-xs text-slate-500">
            {unreachable ? 'Serviços reiniciando — a conexão volta sozinha.' : 'Isso costuma levar de 3 a 10 minutos.'}
            {elapsed > 0 && ` · ${Math.floor(elapsed / 60)}min ${elapsed % 60}s`}
          </p>
        )}

        {(done || failed) && (
          <div className="mt-7 flex justify-center gap-2">
            <button onClick={onDismiss} className="rounded-lg px-4 py-2 text-sm text-slate-400 hover:text-slate-200">
              Fechar
            </button>
            <button onClick={() => window.location.reload()} className="btn-primary px-4 py-2 text-sm">
              Recarregar painel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
