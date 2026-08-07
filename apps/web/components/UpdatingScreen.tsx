'use client';

import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { IconCheck } from './icons';
import { NetworkPulse } from './NetworkPulse';

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
  /** Desconhecido quando a tela abre pra um usuário que não disparou a
   * atualização — ele não passou pela consulta de releases. */
  toVersion?: string;
  onDismiss: () => void;
}

const POLL_MS = 3000;
const PHRASE_MS = 7000;

/**
 * A atualização leva minutos e a tela é bloqueante: sem nada mudando, dá a
 * impressão de travamento. Cada frase carrega uma informação verdadeira e útil
 * — o que está acontecendo, o que continua no ar, o que é seguro fazer — em vez
 * de encher linguiça só pra ter movimento.
 */
const PHRASES = [
  'Boa hora para um café — isso leva alguns minutos.',
  'Seus servidores e as aplicações neles continuam rodando normalmente.',
  'Pode fechar esta aba: a atualização segue no servidor de qualquer forma.',
  'As imagens estão sendo reconstruídas do zero com a nova versão.',
  'O banco, o .env e os volumes são preservados — nada é recriado.',
  'As migrações do banco rodam sozinhas quando a API subir.',
  'O painel volta a responder assim que os serviços terminarem de subir.',
];

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
  const [phrase, setPhrase] = useState(0);
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
    const phraseTimer = setInterval(() => setPhrase((i) => (i + 1) % PHRASES.length), PHRASE_MS);
    return () => {
      cancelled = true;
      clearInterval(pollTimer);
      clearInterval(clockTimer);
      clearInterval(phraseTimer);
    };
  }, []);

  const failed = status?.state === 'error';
  const done = status?.state === 'success';
  const active = stepIndex(status, unreachable);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-6 backdrop-blur-xl">
      <div className="w-full max-w-md text-center">
        <NetworkPulse state={failed ? 'error' : done ? 'success' : 'running'} className="mx-auto mb-7 h-[12.5rem] w-[12.5rem]" ariaLabel="Atualizando" />

        <h2 className="text-xl font-semibold text-white">
          {failed ? 'A atualização falhou' : done ? (toVersion ? `Atualizado para v${toVersion}` : 'Velix atualizado') : 'Atualizando o Velix'}
        </h2>
        <p className="mt-1.5 text-sm text-slate-400">
          {failed
            ? status?.message ?? 'Veja .velix-update.log no diretório de instalação.'
            : done
              ? 'Recarregue o painel para usar a nova versão.'
              : `${toVersion ? `v${fromVersion} → v${toVersion} · ` : ''}o painel fica indisponível durante o processo`}
        </p>

        {/* Barra por etapa concluída, não por tempo estimado: o tempo real
            varia de 2 a 15 minutos com a máquina e a rede, e uma barra que
            "estima" fica presa em 90% — o clássico que faz ninguém confiar em
            barra de progresso. Aqui cada traço é uma etapa que de fato acabou. */}
        <div className="mx-auto mt-6 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-slate-800">
          <div
            className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-400 transition-[width] duration-700"
            style={{ width: `${Math.round(((done ? STEPS.length : active) / STEPS.length) * 100)}%` }}
          />
        </div>
        <p className="mt-1.5 text-[11px] text-slate-500">
          {done ? STEPS.length : active} de {STEPS.length} etapas
          {status?.requestedBy ? ` · iniciada por ${status.requestedBy}` : ''}
        </p>

        <ol className="mx-auto mt-6 max-w-xs space-y-2.5 text-left">
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
          <>
            {/* key força o remount a cada troca, que é o que dispara a animação
                de entrada — sem isso o texto trocaria seco. */}
            <p key={phrase} className="animate-fade-up mx-auto mb-1 mt-7 flex min-h-[3rem] max-w-sm items-center justify-center text-sm text-slate-300">
              {unreachable ? 'Serviços reiniciando — a conexão volta sozinha.' : PHRASES[phrase]}
            </p>
            <p className="text-xs text-slate-500">
              {Math.floor(elapsed / 60)}min {elapsed % 60}s · normalmente de 3 a 10 minutos
            </p>
          </>
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
