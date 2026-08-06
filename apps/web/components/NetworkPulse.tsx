'use client';

export type PulseState = 'running' | 'success' | 'error';

/** Seis nós na malha: o suficiente pra leitura de rede sem virar poluição. */
const NODES = [0, 60, 120, 180, 240, 300];

const TONES: Record<PulseState, { tone: string; accent: string }> = {
  running: { tone: '#818cf8', accent: '#c4b5fd' },
  success: { tone: '#4ade80', accent: '#86efac' },
  error: { tone: '#f87171', accent: '#fca5a5' },
};

interface Props {
  state: PulseState;
  /** Conteúdo do hub: uma letra, ou nada pra usar o símbolo padrão do estado. */
  label?: string;
  /** Só tamanho e posicionamento — a classe `velix-net`, que carrega as regras
   * de transform da animação, é sempre aplicada e não deve ser omitida. */
  className?: string;
  ariaLabel?: string;
}

/**
 * Nó central irradiando pacotes para os nós da malha — a imagem é a própria
 * infraestrutura que o Velix gerencia, em vez de um spinner qualquer. SVG
 * inline com animação em CSS (ver globals.css): sem dependência nova, e o
 * `prefers-reduced-motion` já existente no projeto neutraliza tudo de uma vez.
 *
 * Os ids dos gradientes carregam o estado no nome porque a mesma tela pode
 * montar duas instâncias (ex.: uma malha por serviço) — ids repetidos fariam a
 * segunda herdar as cores da primeira, já que <defs> é global no documento.
 */
export function NetworkPulse({ state, label = 'V', className = 'h-32 w-32', ariaLabel }: Props) {
  const { tone, accent } = TONES[state];
  const moving = state === 'running';
  const glowId = `velix-net-glow-${state}`;
  const hubId = `velix-net-hub-${state}`;

  return (
    <svg viewBox="0 0 200 200" className={`velix-net ${className}`} role="img" aria-label={ariaLabel ?? 'Progresso'}>
      <defs>
        <radialGradient id={glowId}>
          <stop offset="0%" stopColor={tone} stopOpacity="0.85" />
          <stop offset="100%" stopColor={tone} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={hubId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={accent} />
          <stop offset="100%" stopColor={tone} />
        </linearGradient>
      </defs>

      <circle cx="100" cy="100" r="70" fill={`url(#${glowId})`} className={moving ? 'velix-net__halo' : ''} opacity="0.45" />

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
          <path d="M100 100 L100 24 A76 76 0 0 1 152 46 Z" fill={`url(#${glowId})`} />
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

      <circle cx="100" cy="100" r="26" fill={`url(#${hubId})`} />
      {state === 'running' ? (
        <text x="100" y="101" textAnchor="middle" dominantBaseline="central" fontSize="24" fontWeight="700" fill="#fff">
          {label}
        </text>
      ) : (
        <g transform="translate(88 88)" stroke="#fff" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round">
          {state === 'success' ? <path d="M4 13l6 6L20 5" /> : <path d="M12 5v10M12 19h.01" />}
        </g>
      )}
    </svg>
  );
}
