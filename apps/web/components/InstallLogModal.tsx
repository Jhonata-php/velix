'use client';

import { useEffect, useRef, useState } from 'react';
import { getToken } from '@/lib/api';
import '@xterm/xterm/css/xterm.css';

type Op = 'docker-install' | 'easypanel-install' | 'updates-install';

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
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        theme: { background: '#0f172a' },
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

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-slate-800 bg-slate-900 shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
            <p className="text-xs text-slate-400">
              {status === 'connecting' && 'Conectando...'}
              {status === 'running' && 'Executando...'}
              {status === 'done-ok' && 'Concluído com sucesso'}
              {status === 'done-error' && 'Falhou — veja o log abaixo'}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={!canClose}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Fechar
          </button>
        </div>
        <div ref={containerRef} className="h-[50vh] flex-1 overflow-hidden p-2" />
      </div>
    </div>
  );
}
