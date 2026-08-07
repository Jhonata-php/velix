'use client';

import { useEffect, useRef, useState } from 'react';
import { getToken } from '@/lib/api';
import { TERMINAL_THEME } from '@/lib/terminalTheme';
import { TerminalModal } from './TerminalChrome';
import '@xterm/xterm/css/xterm.css';

export type Op =
  | 'docker-install'
  | 'docker-uninstall'
  | 'traefik-install'
  | 'traefik-uninstall'
  | 'server-prepare'
  | 'app-deploy'
  | 'git-deploy'
  | 'git-redeploy'
  | 'container-logs'
  | 'service-add'
  | 'updates-install'
  | 'mysql-install';

export type OpsLogStatus = 'connecting' | 'running' | 'done-ok' | 'done-error';

interface PanelProps {
  serverId: string;
  op: Op;
  params?: Record<string, unknown>;
  onDone: (ok: boolean, result: unknown) => void;
  onStatusChange?: (status: OpsLogStatus) => void;
  /** Cada linha completa de saída, já sem quebras — permite que uma tela de
   * progresso acompanhe o que está acontecendo de verdade em vez de exibir
   * frases genéricas em rodízio. */
  onLine?: (line: string) => void;
}

/** Terminal + WebSocket do canal /ops, sem moldura de modal — reutilizável tanto
 * pelo `InstallLogModal` (overlay de tela cheia) quanto embutido dentro de outro
 * layout (ex.: a etapa "Implantação" do assistente de instalação). */
export function OpsLogPanel({ serverId, op, params, onDone, onStatusChange, onLine }: PanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Em ref, não em estado: o efeito que abre o WebSocket não pode depender de
  // uma função nova a cada render, senão reconecta e reinicia a operação.
  const onLineRef = useRef(onLine);
  onLineRef.current = onLine;

  function setStatus(s: OpsLogStatus) {
    onStatusChange?.(s);
  }

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

      let buffer = '';
      const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${protocol}://${location.host}/ops?serverId=${serverId}&token=${getToken()}`);

      ws.onopen = () => {
        setStatus('running');
        ws?.send(JSON.stringify({ type: 'start', op, params }));
      };
      ws.onerror = () => {
        term?.write('\r\n\x1b[31mFalha na conexão do canal de log.\x1b[0m\r\n');
        setStatus('done-error');
      };
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'log') {
          term?.write(msg.data.replace(/\n/g, '\r\n'));
          if (onLineRef.current) {
            // Um chunk pode trazer várias linhas ou meia linha; só as completas
            // interessam pra quem está mostrando "o que está acontecendo agora".
            buffer += msg.data;
            const parts = buffer.split('\n');
            buffer = parts.pop() ?? '';
            for (const line of parts) {
              const clean = line.replace(/\x1b\[[0-9;]*m/g, '').trim();
              if (clean) onLineRef.current(clean);
            }
          }
        } else if (msg.type === 'done') {
          const ok = !!msg.ok;
          term?.write(`\r\n\x1b[${ok ? '32' : '31'}m${ok ? '✓ Concluído com sucesso.' : '✗ Falhou.'}\x1b[0m\r\n`);
          setStatus(ok ? 'done-ok' : 'done-error');
          onDone(ok, ok ? msg.result : msg.error);
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

  return <div ref={containerRef} className="h-full w-full overflow-hidden" />;
}

interface Props {
  serverId: string;
  op: Op;
  params?: Record<string, unknown>;
  title: string;
  onClose: () => void;
  onDone: (ok: boolean, result: unknown) => void;
}

const STATUS_BADGE: Record<OpsLogStatus, string> = {
  connecting: 'bg-slate-800 text-slate-300',
  running: 'bg-amber-500/15 text-amber-400',
  'done-ok': 'bg-green-500/15 text-green-400',
  'done-error': 'bg-red-500/15 text-red-400',
};

export function InstallLogModal({ serverId, op, params, title, onClose, onDone }: Props) {
  const [status, setStatus] = useState<OpsLogStatus>('connecting');
  const canClose = status === 'done-ok' || status === 'done-error';

  return (
    <TerminalModal
      title={title}
      actions={
        <>
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
        </>
      }
      bodyClassName="flex h-[50vh] flex-1 p-3"
    >
      <OpsLogPanel serverId={serverId} op={op} params={params} onDone={onDone} onStatusChange={setStatus} />
    </TerminalModal>
  );
}
