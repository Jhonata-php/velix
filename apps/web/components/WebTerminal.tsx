'use client';

import { useEffect, useRef, useState } from 'react';
import { useTheme } from 'next-themes';
import { getToken } from '@/lib/api';
import { getTerminalTheme } from '@/lib/terminalTheme';
import { TerminalWindow } from './TerminalChrome';
import '@xterm/xterm/css/xterm.css';

/** Terminal web genérico (xterm.js + WebSocket) — mesma lógica de
 * `TerminalTab` (SSH direto no servidor, em servers/[id]/page.tsx), extraída
 * pra componente reaproveitável: aqui o `wsPath` decide o que abre do outro
 * lado (SSH cru, ou — como em container-shell.util.ts no backend — um
 * `docker exec` dentro de um container específico). */
export function WebTerminal({ wsPath, title }: { wsPath: string; title: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<import('@xterm/xterm').Terminal | null>(null);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'closed' | 'error'>('connecting');
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = getTerminalTheme(isDark);
  }, [isDark]);

  useEffect(() => {
    let disposed = false;
    let ws: WebSocket | null = null;
    let term: import('@xterm/xterm').Terminal | null = null;
    let resizeObserver: ResizeObserver | null = null;

    async function start() {
      const { Terminal } = await import('@xterm/xterm');
      const { FitAddon } = await import('@xterm/addon-fit');
      if (disposed || !containerRef.current) return;

      term = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        lineHeight: 1.4,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        theme: getTerminalTheme(isDark),
      });
      termRef.current = term;
      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(containerRef.current);
      fitAddon.fit();

      const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
      const separator = wsPath.includes('?') ? '&' : '?';
      ws = new WebSocket(`${protocol}://${location.host}${wsPath}${separator}token=${getToken()}`);

      ws.onopen = () => setStatus('connected');
      ws.onclose = () => setStatus('closed');
      ws.onerror = () => setStatus('error');
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'data') term?.write(msg.data);
        else if (msg.type === 'error') term?.write(`\r\n\x1b[31m${msg.message}\x1b[0m\r\n`);
        else if (msg.type === 'closed') term?.write('\r\n\x1b[33mConexão encerrada.\x1b[0m\r\n');
      };

      term.onData((data) => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: 'input', data })));

      const sendResize = () => {
        fitAddon.fit();
        if (ws?.readyState === WebSocket.OPEN && term) {
          ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
        }
      };
      resizeObserver = new ResizeObserver(sendResize);
      resizeObserver.observe(containerRef.current);
    }

    start();

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      ws?.close();
      term?.dispose();
      termRef.current = null;
    };
  }, [wsPath]);

  const STATUS_DOT: Record<typeof status, string> = {
    connecting: 'bg-slate-500 animate-pulse',
    connected: 'bg-green-400',
    closed: 'bg-slate-500',
    error: 'bg-red-400',
  };

  return (
    <TerminalWindow
      title={title}
      statusSlot={
        <span className="flex items-center gap-1.5 text-xs text-slate-400">
          <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} />
          {status === 'connecting' && 'Conectando...'}
          {status === 'connected' && 'Conectado'}
          {status === 'closed' && 'Desconectado'}
          {status === 'error' && 'Falha na conexão do terminal'}
        </span>
      }
      bodyClassName="p-3"
    >
      <div ref={containerRef} className="h-[60vh] overflow-hidden" />
    </TerminalWindow>
  );
}
