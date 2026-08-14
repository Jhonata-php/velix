import { IconServer, IconLayers, IconActivity, IconDownload } from '../icons';
import { InfraDiagram } from './InfraDiagram';

// Composição institucional (sem dados reais) — só pra transmitir identidade
// antes do login. Sempre no tema escuro independente do tema do resto do
// app: é uma escolha de marca (como a maioria dos SaaS premium faz), não uma
// inversão de cores esquecida.
const STATS = [
  { icon: IconServer, label: 'Servidores online', value: '12 de 12' },
  { icon: IconLayers, label: 'Aplicações', value: '28 ativas' },
  { icon: IconActivity, label: 'Disponibilidade', value: '99,99%' },
  { icon: IconDownload, label: 'Atualização', value: 'v1.2.0 disponível' },
];

export function AuthVisualPanel() {
  return (
    <div className="relative hidden h-full flex-col justify-between overflow-hidden bg-[#09090b] px-12 py-12 text-white lg:flex lg:w-[58%] xl:w-[60%]">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div
          className="absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)',
            backgroundSize: '48px 48px',
          }}
        />
        <div className="animate-blob-1 absolute -left-32 -top-16 h-[32rem] w-[32rem] rounded-full bg-indigo-500/20 blur-3xl" />
        <div className="animate-blob-2 absolute -right-40 bottom-0 h-[28rem] w-[28rem] rounded-full bg-cyan-400/10 blur-3xl" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#09090b] via-transparent to-[#09090b]/40" />
      </div>

      <div className="relative z-10 max-w-lg">
        <div className="animate-logo-pop mb-10 flex items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-wordmark-white.png" alt="Velix" className="h-8" />
        </div>

        <h1 className="animate-fade-up text-4xl font-bold leading-[1.1] tracking-tight xl:text-5xl">Infraestrutura sob controle.</h1>
        <p className="animate-fade-up mt-4 max-w-md text-base leading-relaxed text-slate-400 [animation-delay:80ms]">
          Gerencie servidores, aplicações, bancos de dados e disponibilidade em um único lugar.
        </p>

        <div className="animate-fade-up mt-10 grid grid-cols-2 gap-3 [animation-delay:160ms]">
          {STATS.map((s) => (
            <div key={s.label} className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5 backdrop-blur-sm">
              <div className="mb-1.5 flex items-center gap-1.5 text-slate-400">
                <s.icon className="h-3.5 w-3.5" aria-hidden />
                <span className="text-[11px] font-medium uppercase tracking-wider">{s.label}</span>
              </div>
              <p className="text-lg font-semibold text-white">{s.value}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="animate-fade-up relative z-10 [animation-delay:240ms]">
        <InfraDiagram />
      </div>

      <p className="relative z-10 text-xs tracking-wide text-slate-500">Controle. Continuidade. Disponibilidade.</p>
    </div>
  );
}
