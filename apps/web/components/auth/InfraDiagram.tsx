import { IconGlobe, IconServer, IconHardDrive, IconBox } from '../icons';

// Composição institucional (nenhum dado real) mostrando como as peças do
// Velix se conectam — Servidor principal como hub, com um pulso viajando
// pelas linhas pra dar sensação de "vivo"/monitorado. Puro SVG, sem imagem.
const NODES = [
  { key: 'cloudflare', x: 20, y: 20, label: 'Cloudflare', icon: IconGlobe },
  { key: 'primary', x: 195, y: 20, label: 'Servidor principal', icon: IconServer },
  { key: 'secondary', x: 370, y: 20, label: 'Servidor secundário', icon: IconServer },
  { key: 'containers', x: 20, y: 130, label: 'Containers', icon: IconBox },
  { key: 'database', x: 195, y: 130, label: 'Banco de dados', icon: IconHardDrive },
] as const;

const NODE_W = 155;
const NODE_H = 44;

function center(node: (typeof NODES)[number]) {
  return { cx: node.x + NODE_W / 2, cy: node.y + NODE_H / 2 };
}

function Pulse({ x1, y1, x2, y2, delay = '0s' }: { x1: number; y1: number; x2: number; y2: number; delay?: string }) {
  return (
    <circle r="2.5" fill="#8f7cff" className="motion-reduce:hidden">
      <animate attributeName="cx" values={`${x1};${x2}`} dur="2.4s" begin={delay} repeatCount="indefinite" />
      <animate attributeName="cy" values={`${y1};${y2}`} dur="2.4s" begin={delay} repeatCount="indefinite" />
      <animate attributeName="opacity" values="0;1;1;0" dur="2.4s" begin={delay} repeatCount="indefinite" />
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
    <svg viewBox="0 0 545 190" className="w-full max-w-lg" role="img" aria-label="Diagrama ilustrativo da infraestrutura: Cloudflare, servidores e banco de dados conectados">
      <g stroke="rgba(255,255,255,0.14)" strokeWidth="1.5" fill="none">
        <line x1={cloudflare.cx} y1={cloudflare.cy} x2={primary.cx} y2={primary.cy} />
        <line x1={primary.cx} y1={primary.cy} x2={secondary.cx} y2={secondary.cy} strokeDasharray="4 3" />
        <line x1={primary.cx} y1={primary.cy} x2={containers.cx} y2={containers.cy} />
        <line x1={primary.cx} y1={primary.cy} x2={database.cx} y2={database.cy} />
      </g>

      <text x={(primary.cx + secondary.cx) / 2} y={primary.cy - 8} textAnchor="middle" className="fill-slate-500 text-[9px] font-medium uppercase tracking-wider">
        replicação
      </text>

      <Pulse x1={cloudflare.cx} y1={cloudflare.cy} x2={primary.cx} y2={primary.cy} delay="0s" />
      <Pulse x1={primary.cx} y1={primary.cy} x2={secondary.cx} y2={secondary.cy} delay="0.6s" />
      <Pulse x1={primary.cx} y1={primary.cy} x2={database.cx} y2={database.cy} delay="1.2s" />

      {NODES.map((node) => {
        const Icon = node.icon;
        const isPrimary = node.key === 'primary';
        return (
          <foreignObject key={node.key} x={node.x} y={node.y} width={NODE_W} height={NODE_H}>
            <div
              className={`flex h-full items-center gap-1.5 rounded-lg border px-2.5 backdrop-blur-sm ${
                isPrimary ? 'border-indigo-400/40 bg-indigo-500/15' : 'border-white/10 bg-white/[0.04]'
              }`}
            >
              <Icon className={`h-3.5 w-3.5 shrink-0 ${isPrimary ? 'text-indigo-300' : 'text-slate-400'}`} />
              <span className={`truncate text-[10px] font-medium ${isPrimary ? 'text-indigo-100' : 'text-slate-300'}`}>{node.label}</span>
              <span aria-hidden className={`ml-auto h-1.5 w-1.5 shrink-0 rounded-full ${isPrimary ? 'bg-green-400' : 'bg-green-500/70'}`} />
            </div>
          </foreignObject>
        );
      })}
    </svg>
  );
}
