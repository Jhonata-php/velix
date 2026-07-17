'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { TerminalModal, TerminalActionButton } from './TerminalChrome';
import { IconRefresh, IconX, IconPower, IconTrash } from './icons';

function LogLine({ line }: { line: string }) {
  const color = /\berror\b/i.test(line)
    ? 'text-red-400'
    : /\bwarn(ing)?\b/i.test(line)
      ? 'text-amber-400'
      : /\blog\b/i.test(line)
        ? 'text-green-400'
        : 'text-slate-300';
  return <div className={color}>{line || ' '}</div>;
}

export function ContainerLogsModal({
  serverId,
  containerId,
  title,
  running,
  busy,
  onToggle,
  onRemove,
  onClose,
}: {
  serverId: string;
  containerId: string;
  title: string;
  running?: boolean;
  busy?: boolean;
  onToggle?: () => void;
  onRemove?: () => void;
  onClose: () => void;
}) {
  const [logs, setLogs] = useState('');
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    apiFetch<{ logs: string }>(`/servers/${serverId}/docker/containers/${containerId}/logs?tail=300`)
      .then((res) => setLogs(res.logs))
      .finally(() => setLoading(false));
  }

  useEffect(load, [serverId, containerId]);

  return (
    <TerminalModal
      title={title}
      bodyClassName="h-[60vh] overflow-auto whitespace-pre-wrap break-all p-3 font-mono text-xs leading-relaxed"
      actions={
        <>
          {onToggle && (
            <TerminalActionButton onClick={onToggle} disabled={busy} title={running ? 'Parar' : 'Iniciar'} tone={running ? 'success' : 'default'}>
              <IconPower className="h-4 w-4" />
            </TerminalActionButton>
          )}
          {onRemove && (
            <TerminalActionButton onClick={onRemove} disabled={busy} title="Remover" tone="danger">
              <IconTrash className="h-4 w-4" />
            </TerminalActionButton>
          )}
          <span className="mx-1 h-4 w-px bg-white/10" />
          <TerminalActionButton onClick={load} disabled={loading} title="Atualizar">
            <IconRefresh className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </TerminalActionButton>
          <TerminalActionButton onClick={onClose} title="Fechar">
            <IconX className="h-4 w-4" />
          </TerminalActionButton>
        </>
      }
    >
      {loading && !logs ? <span className="text-slate-500">Carregando...</span> : logs.split('\n').map((l, i) => <LogLine key={i} line={l} />)}
    </TerminalModal>
  );
}
