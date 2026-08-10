'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { getToken } from '@/lib/api';
import { IconSearch, IconCopy, IconCheck, IconRefresh } from './icons';

const MAX_LINES = 5000;

/**
 * Acompanhamento de logs ao vivo, com busca — painel embutido na própria
 * tela do serviço (não um modal que precisa de um clique extra pra abrir).
 *
 * O que existia era `docker logs --tail` num terminal: bom pra olhar o
 * passado, inútil pra acompanhar um erro acontecendo. Aqui as linhas chegam
 * por streaming, e a busca filtra sem interromper o fluxo — o que continua
 * chegando fica guardado e reaparece quando o filtro sai.
 *
 * O buffer é limitado porque um container falante enche a memória da aba em
 * minutos, e o navegador trava antes de qualquer aviso.
 */
export function LiveLogsPanel({ serverId, containerId }: { serverId: string; containerId: string }) {
  const [lines, setLines] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [connected, setConnected] = useState(false);
  const [follow, setFollow] = useState(true);
  const [copied, setCopied] = useState(false);
  const [connectionKey, setConnectionKey] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLines([]);
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${protocol}://${location.host}/ops?serverId=${serverId}&token=${getToken()}`);

    ws.onopen = () => {
      setConnected(true);
      ws.send(JSON.stringify({ type: 'start', op: 'container-logs', params: { containerId } }));
    };
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type !== 'log') return;
      setLines((prev) => {
        const incoming = String(msg.data).split('\n').filter(Boolean);
        const next = [...prev, ...incoming];
        return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
      });
    };

    // Fechar o socket é o que encerra o `docker logs -f` do outro lado.
    return () => ws.close();
  }, [serverId, containerId, connectionKey]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return lines;
    return lines.filter((l) => l.toLowerCase().includes(q));
  }, [lines, search]);

  // Só rola sozinho enquanto o usuário não subiu pra ler algo — puxar a tela
  // de volta pro fim no meio de uma leitura é a forma mais rápida de irritar.
  //
  // `scrollTop` direto no container, nunca `scrollIntoView` — esse método
  // rola qualquer ancestral que precise pra trazer o alvo à vista, incluindo
  // a PÁGINA inteira quando o painel de log não estava totalmente visível
  // (ex.: mais embaixo na tela). Resultado: a página inteira pulava pra
  // baixo sozinha a cada linha nova chegando, mesmo com o usuário lendo
  // outra parte da tela. `scrollTop` só mexe neste container.
  useEffect(() => {
    if (follow && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [visible, follow]);

  async function copyAll() {
    await navigator.clipboard.writeText(visible.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="card overflow-hidden p-0">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5 dark:border-slate-700">
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Logs</h3>
        <div className="flex items-center gap-2">
          <span className={`badge ${connected ? 'bg-green-500/10 text-green-500' : 'bg-slate-500/10 text-slate-400'}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'animate-pulse bg-green-500' : 'bg-slate-400'}`} />
            {connected ? 'ao vivo' : 'desconectado'}
          </span>
          {!connected && (
            <button
              onClick={() => setConnectionKey((k) => k + 1)}
              aria-label="Reconectar"
              className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-100"
            >
              <IconRefresh className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
        </div>
      </div>

      <div className="p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filtrar linhas..."
              className="input h-8 w-full py-0 pl-8 text-xs"
            />
          </div>
          <button onClick={copyAll} className="btn-secondary flex shrink-0 items-center gap-1.5 px-2.5 py-1.5 text-xs">
            {copied ? <IconCheck className="h-3.5 w-3.5 text-green-500" /> : <IconCopy className="h-3.5 w-3.5" />}
            {copied ? 'Copiado' : 'Copiar'}
          </button>
        </div>

        <div
          ref={scrollRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
          }}
          className="h-80 overflow-y-auto rounded-lg bg-slate-950 p-3 font-mono text-[11.5px] leading-relaxed text-slate-300"
        >
          {visible.length === 0 ? (
            <p className="text-slate-500">{search ? 'Nenhuma linha corresponde ao filtro.' : 'Aguardando saída do container...'}</p>
          ) : (
            visible.map((line, i) => (
              <div key={i} className="whitespace-pre-wrap break-all">
                {line}
              </div>
            ))
          )}
        </div>

        <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
          <span>
            {search ? `${visible.length} de ${lines.length} linhas` : `${lines.length} linhas`}
            {lines.length >= MAX_LINES ? ' · mostrando as mais recentes' : ''}
          </span>
          {!follow && (
            <button onClick={() => setFollow(true)} className="font-medium text-indigo-500 hover:underline">
              Voltar ao fim
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
