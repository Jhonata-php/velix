'use client';

import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { IconCheck } from './icons';

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

/** Seis nós na malha: o suficiente pra leitura de rede sem virar poluição. */
const NODES = [0, 60, 120, 180, 240, 300];

/**
 * Nó central irradiando pacotes para os nós da malha — a imagem é a própria
 * infraestrutura que o Velix gerencia, em vez de um spinner qualquer. SVG
 * inline com animação em CSS (ver globals.css): sem dependência nova e o
 * `prefers-reduced-motion` já existente neutraliza tudo de uma vez.
 */
function NetworkPulse({ state }: { state: 'running' | 'success' | 'error' }) {
  const tone = state === 'error' ? '#f87171' : state === 'success' ? '#4ade80' : '#818cf8';
  const accent = state === 'error' ? '#fca5a5' : state === 'success' ? '#86efac' : '#c4b5fd';
  const moving = state === 'running';

  return (
    <svg viewBox="0 0 200 200" className="velix-net mx-auto mb-7" role="img" aria-label="Atualizando">
      <defs>
        <radialGradient id="velix-net-glow">
          <stop offset="0%" stopColor={tone} stopOpacity="0.85" />
          <stop offset="100%" stopColor={tone} stopOpacity="0" />
        </radialGradient>
        <linearGradient id="velix-net-hub" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={accent} />
          <stop offset="100%" stopColor={tone} />
        </linearGradient>
      </defs>

      <circle cx="100" cy="100" r="70" fill="url(#velix-net-glow)" className={moving ? 'velix-net__halo' : ''} opacity="0.45" />

      {/* Polígono ligando os nós: é o que faz a figura ler como malha, e não
          como um sol com raios. */}
      <polygon
        points={NODES.map((a) => {
          const rad = (a * Math.PI) / 180;
          return `${100 + 76 * Math.cos(rad)},${100 + 76 * Math.sin(rad)}`;
        }).join(' ')}
        fill="none"
        stroke={tone}
        strokeWidth="0.75"
        opacity="0.22"
      />

      {moving && (
        <g className="velix-net__sweep" opacity="0.25">
          <path d="M100 100 L100 24 A76 76 0 0 1 152 46 Z" fill={`url(#velix-net-glow)`} />
        </g>
      )}

      <g style={{ color: tone }}>
        {NODES.map((angle, i) => (
          <g key={angle} className="velix-net__spoke" style={{ '--angle': `${angle}deg` } as React.CSSProperties}>
            <line x1="128" y1="100" x2="176" y2="100" className={moving ? 'velix-net__link' : ''} stroke={tone} strokeWidth="1.3" opacity="0.45" />
            <circle
              cx="176"
              cy="100"
              r="4.5"
              fill={tone}
              className={moving ? 'velix-net__node' : ''}
              style={{ '--delay': `${i * 0.28}s` } as React.CSSProperties}
              opacity={moving ? undefined : 0.8}
            />
            {moving && (
              <circle
                cx="100"
                cy="100"
                r="2.5"
                fill={accent}
                className="velix-net__packet"
                style={{ '--delay': `${i * 0.36}s` } as React.CSSProperties}
              />
            )}
          </g>
        ))}
      </g>

      <circle cx="100" cy="100" r="26" fill="url(#velix-net-hub)" />
      {state === 'running' ? (
        <text x="100" y="101" textAnchor="middle" dominantBaseline="central" fontSize="24" fontWeight="700" fill="#fff">
          V
        </text>
      ) : (
        <g transform="translate(88 88) scale(1)" stroke="#fff" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round">
          {state === 'success' ? <path d="M4 13l6 6L20 5" /> : <path d="M12 5v10M12 19h.01" />}
        </g>
      )}
    </svg>
  );
}

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
        <NetworkPulse state={failed ? 'error' : done ? 'success' : 'running'} />

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
