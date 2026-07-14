'use client';

import { useEffect, useRef, useState } from 'react';
import { getToken } from '@/lib/api';
import { TERMINAL_THEME } from '@/lib/terminalTheme';
import '@xterm/xterm/css/xterm.css';

type Op = 'docker-install' | 'docker-uninstall' | 'easypanel-install' | 'easypanel-uninstall' | 'updates-install' | 'mysql-install';

interface Props {
  serverId: string;
  op: Op;
  params?: Record<string, unknown>;
  title: string;
  onClose: () => void;
  onDone: (ok: boolean, result: unknown) => void;
}

export function InstallLogModal({ serverId, op, params, title, onClose, onDone }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'connecting' | 'running' | 'done-ok' | 'done-error'>('connecting');
  const [canClose, setCanClose] = useState(false);

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
        disableStdin: true,
        cursorBlink: false,
        fontSize: 12,
        lineHeight: 1.4,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        theme: TERMINAL_THEME,
      });
      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(containerRef.current);
      fitAddon.fit();
      resizeObserver = new ResizeObserver(() => fitAddon.fit());
      resizeObserver.observe(containerRef.current);

      const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${protocol}://${location.host}/ops?serverId=${serverId}&token=${getToken()}`);

      ws.onopen = () => {
        setStatus('running');
        ws?.send(JSON.stringify({ type: 'start', op, params }));
      };
      ws.onerror = () => {
        term?.write('\r\n\x1b[31mFalha na conexão do canal de log.\x1b[0m\r\n');
        setStatus('done-error');
        setCanClose(true);
      };
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'log') {
          term?.write(msg.data.replace(/\n/g, '\r\n'));
        } else if (msg.type === 'done') {
          const ok = !!msg.ok;
          term?.write(`\r\n\x1b[${ok ? '32' : '31'}m${ok ? '✓ Concluído com sucesso.' : '✗ Falhou.'}\x1b[0m\r\n`);
          setStatus(ok ? 'done-ok' : 'done-error');
          setCanClose(true);
          onDone(ok, msg.result);
        }
      };
    }

    start();

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      ws?.close();
      term?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId, op]);

  const STATUS_BADGE: Record<typeof status, string> = {
    connecting: 'bg-slate-800 text-slate-300',
    running: 'bg-amber-500/15 text-amber-400',
    'done-ok': 'bg-green-500/15 text-green-400',
    'done-error': 'bg-red-500/15 text-red-400',
  };

  return (
    <div className="overlay-fade fixed inset-0 z-30 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-md">
      <div className="modal-pop flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-800 bg-[#111318] shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-white/5 bg-[#16181f] px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex shrink-0 gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
            </div>
            <h2 className="truncate text-sm font-medium text-slate-200">{title}</h2>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className={`badge ${STATUS_BADGE[status]}`}>
              {(status === 'running' || status === 'connecting') && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
              {status === 'connecting' && 'Conectando'}
              {status === 'running' && 'Executando'}
              {status === 'done-ok' && 'Concluído'}
              {status === 'done-error' && 'Falhou'}
            </span>
            <button
              onClick={onClose}
              disabled={!canClose}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Fechar
            </button>
          </div>
        </div>
        <div ref={containerRef} className="h-[50vh] flex-1 overflow-hidden bg-[#0a0a0f] p-3" />
      </div>
    </div>
  );
}
