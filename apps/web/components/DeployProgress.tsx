'use client';

import { useEffect, useRef, useState } from 'react';
import { NetworkPulse } from './NetworkPulse';
import { IconCheck, IconTerminal } from './icons';

export interface ProgressStage {
  label: string;
  /** Trechos que, aparecendo no log, indicam que esta etapa começou. */
  match: RegExp;
}

interface Props {
  stages: ProgressStage[];
  /** Última linha vinda do log — é o que faz a tela ter vida de verdade. */
  lastLine: string | null;
  state: 'running' | 'success' | 'error';
  title: string;
  subtitle?: string;
  label?: string;
  showLog: boolean;
  onToggleLog: () => void;
  children?: React.ReactNode;
}

function useElapsed(active: boolean) {
  const [seconds, setSeconds] = useState(0);
  const start = useRef(Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - start.current) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return seconds;
}

/**
 * Progresso guiado pelo log real, não por frases em rodízio.
 *
 * A versão anterior mostrava textos genéricos alternando a cada 6 segundos —
 * movimento sem informação: dizia "construindo a imagem" mesmo quando o build
 * já tinha acabado. Aqui as etapas avançam quando o log de fato menciona cada
 * uma, e a última linha aparece embaixo, então dá pra ver que algo está
 * acontecendo mesmo numa etapa longa.
 *
 * A etapa nunca retrocede: um log pode voltar a citar algo de uma fase anterior
 * (o Docker repete camadas em cache, por exemplo) e o indicador andar pra trás
 * passaria a impressão de que deu errado.
 */
export function DeployProgress({ stages, lastLine, state, title, subtitle, label, showLog, onToggleLog, children }: Props) {
  const [reached, setReached] = useState(0);
  const elapsed = useElapsed(state === 'running');

  useEffect(() => {
    if (!lastLine) return;
    const index = stages.findIndex((s) => s.match.test(lastLine));
    if (index > -1) setReached((current) => Math.max(current, index));
  }, [lastLine, stages]);

  const done = state === 'success';
  const failed = state === 'error';
  const active = done ? stages.length : reached;

  return (
    <div className="flex flex-col items-center py-2 text-center">
      <NetworkPulse state={state} label={label} className="h-32 w-32" ariaLabel={title} />

      <h3 className="mt-5 text-lg font-semibold text-slate-900 dark:text-slate-50">{title}</h3>
      {subtitle && <p className="mt-1.5 max-w-md px-4 text-sm text-slate-500">{subtitle}</p>}

      <ol className="mx-auto mt-6 w-full max-w-sm space-y-2 text-left">
        {stages.map((stage, i) => {
          const status = failed && i === active ? 'failed' : i < active ? 'done' : i === active ? 'current' : 'todo';
          return (
            <li key={stage.label} className="flex items-center gap-2.5 text-sm">
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] transition ${
                  status === 'failed'
                    ? 'bg-red-500 text-white'
                    : status === 'done'
                      ? 'bg-green-500 text-white'
                      : status === 'current'
                        ? 'border-2 border-indigo-400 text-indigo-500'
                        : 'border border-slate-300 text-slate-400 dark:border-slate-600 dark:text-slate-600'
                }`}
              >
                {status === 'done' ? <IconCheck className="h-3 w-3" /> : status === 'failed' ? '!' : i + 1}
              </span>
              <span
                className={
                  status === 'todo'
                    ? 'text-slate-400 dark:text-slate-600'
                    : status === 'current'
                      ? 'font-medium text-slate-800 dark:text-slate-100'
                      : 'text-slate-500'
                }
              >
                {stage.label}
              </span>
              {status === 'current' && state === 'running' && (
                <span className="ml-auto flex gap-0.5" aria-hidden>
                  <Dot delay="0ms" />
                  <Dot delay="150ms" />
                  <Dot delay="300ms" />
                </span>
              )}
            </li>
          );
        })}
      </ol>

      {/* A linha viva: mesmo numa etapa que leva minutos, sempre há algo mudando. */}
      {state === 'running' && (
        <p className="mx-auto mt-4 h-4 w-full max-w-md truncate px-4 font-mono text-[11px] text-slate-400" title={lastLine ?? undefined}>
          {lastLine ?? 'Conectando ao servidor...'}
        </p>
      )}

      {state === 'running' && (
        <p className="mt-1 text-xs text-slate-400">
          {Math.floor(elapsed / 60)}min {elapsed % 60}s
        </p>
      )}

      {children}

      <button
        onClick={onToggleLog}
        className="mt-4 flex items-center gap-1.5 text-xs text-slate-400 transition hover:text-slate-600 dark:hover:text-slate-200"
      >
        <IconTerminal className="h-3.5 w-3.5" aria-hidden />
        {showLog ? 'Ocultar log' : 'Ver log completo'}
      </button>
    </div>
  );
}

function Dot({ delay }: { delay: string }) {
  return <span className="h-1 w-1 animate-pulse rounded-full bg-indigo-400" style={{ animationDelay: delay }} />;
}
