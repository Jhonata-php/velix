import { IconGlobe, IconServer, IconHardDrive, IconBox } from '../icons';

// Composição institucional (nenhum dado real) mostrando como as peças do
// Velix se conectam — Servidor principal como hub, com um pulso viajando
// pelas linhas pra dar sensação de "vivo"/monitorado. Puro SVG, sem imagem.
const NODES = [
  { key: 'cloudflare', x: 8, y: 16, label: 'Cloudflare', icon: IconGlobe },
  { key: 'primary', x: 205, y: 6, label: 'Servidor principal', icon: IconServer, primary: true },
  { key: 'secondary', x: 402, y: 16, label: 'Servidor secundário', icon: IconServer },
  { key: 'containers', x: 8, y: 148, label: 'Containers', icon: IconBox },
  { key: 'database', x: 402, y: 148, label: 'Banco de dados', icon: IconHardDrive },
] as const;

const NODE_W = 168;
const NODE_H = 48;
const PRIMARY_W = 190;
const PRIMARY_H = 56;

function dims(node: (typeof NODES)[number]) {
  return 'primary' in node && node.primary ? { w: PRIMARY_W, h: PRIMARY_H } : { w: NODE_W, h: NODE_H };
}

function center(node: (typeof NODES)[number]) {
  const { w, h } = dims(node);
  return { cx: node.x + w / 2, cy: node.y + h / 2 };
}

function Pulse({ x1, y1, x2, y2, delay = '0s' }: { x1: number; y1: number; x2: number; y2: number; delay?: string }) {
  return (
    <circle r="3" fill="url(#pulseGradient)" className="motion-reduce:hidden">
      <animate attributeName="cx" values={`${x1};${x2}`} dur="2.2s" begin={delay} repeatCount="indefinite" />
      <animate attributeName="cy" values={`${y1};${y2}`} dur="2.2s" begin={delay} repeatCount="indefinite" />
      <animate attributeName="opacity" values="0;1;1;0" dur="2.2s" begin={delay} repeatCount="indefinite" />
    </circle>
  );
}

export function InfraDiagram() {
  const cloudflare = center(NODES[0]);
  const primary = center(NODES[1]);
  const secondary = center(NODES[2]);
  const containers = center(NODES[3]);
  const database = center(NODES[4]);

  return (
    <svg viewBox="0 0 570 220" className="w-full max-w-lg" role="img" aria-label="Diagrama ilustrativo da infraestrutura: Cloudflare, servidores e banco de dados conectados">
      <defs>
        <linearGradient id="pulseGradient" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#a78bfa" stopOpacity="0" />
          <stop offset="100%" stopColor="#c4b5fd" />
        </linearGradient>
        <radialGradient id="primaryGlow" cx="50%" cy="45%" r="65%">
          <stop offset="0%" stopColor="#6d28d9" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#6d28d9" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="lineGradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="rgba(167,139,250,0.35)" />
          <stop offset="100%" stopColor="rgba(167,139,250,0.05)" />
        </linearGradient>
      </defs>

      {/* Brilho suave atrás do nó principal — é o que mais faltava pra ele
          parecer "o centro" em vez de mais uma caixa igual às outras. */}
      <circle cx={primary.cx} cy={primary.cy} r="90" fill="url(#primaryGlow)" />

      <g stroke="url(#lineGradient)" strokeWidth="1.5" fill="none">
        <line x1={cloudflare.cx} y1={cloudflare.cy} x2={primary.cx} y2={primary.cy} />
        <line x1={primary.cx} y1={primary.cy} x2={secondary.cx} y2={secondary.cy} />
        <line x1={primary.cx} y1={primary.cy} x2={containers.cx} y2={containers.cy} />
        <line x1={primary.cx} y1={primary.cy} x2={database.cx} y2={database.cy} />
      </g>

      <text x={(primary.cx + secondary.cx) / 2} y={primary.cy - 14} textAnchor="middle" className="fill-slate-500 text-[9px] font-semibold uppercase tracking-[0.15em]">
        replicação
      </text>

      <Pulse x1={cloudflare.cx} y1={cloudflare.cy} x2={primary.cx} y2={primary.cy} delay="0s" />
      <Pulse x1={primary.cx} y1={primary.cy} x2={secondary.cx} y2={secondary.cy} delay="0.55s" />
      <Pulse x1={primary.cx} y1={primary.cy} x2={containers.cx} y2={containers.cy} delay="1.1s" />
      <Pulse x1={primary.cx} y1={primary.cy} x2={database.cx} y2={database.cy} delay="1.65s" />

      {NODES.map((node) => {
        const Icon = node.icon;
        const isPrimary = 'primary' in node && node.primary;
        const { w, h } = dims(node);
        return (
          <foreignObject key={node.key} x={node.x} y={node.y} width={w} height={h} style={{ overflow: 'visible' }}>
            <div
              className={
                isPrimary
                  ? 'flex h-full items-center gap-2.5 rounded-xl border border-indigo-400/50 bg-gradient-to-br from-indigo-500/25 to-indigo-500/[0.06] px-3.5 shadow-[0_8px_24px_-8px_rgba(99,50,255,0.55)] backdrop-blur-sm'
                  : 'flex h-full items-center gap-2 rounded-xl border border-white/10 bg-white/[0.045] px-3 shadow-[0_4px_16px_-8px_rgba(0,0,0,0.4)] backdrop-blur-sm'
              }
            >
              <span
                className={`flex shrink-0 items-center justify-center rounded-lg ${
                  isPrimary ? 'h-7 w-7 bg-indigo-400/25' : 'h-6 w-6 bg-white/[0.06]'
                }`}
              >
                <Icon className={isPrimary ? 'h-4 w-4 text-indigo-200' : 'h-3.5 w-3.5 text-slate-400'} aria-hidden />
              </span>
              <span className={`truncate font-medium ${isPrimary ? 'text-[12px] text-white' : 'text-[11px] text-slate-300'}`}>{node.label}</span>
              <span aria-hidden className="relative ml-auto flex h-2 w-2 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-60" />
                <span className={`relative inline-flex h-2 w-2 rounded-full ${isPrimary ? 'bg-green-400' : 'bg-green-500/80'}`} />
              </span>
            </div>
          </foreignObject>
        );
      })}
    </svg>
  );
}
