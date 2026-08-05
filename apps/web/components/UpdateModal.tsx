'use client';

import { useState } from 'react';
import { Modal } from './Modal';
import { Alert } from './Alert';
import { IconCopy, IconCheck, IconDownload, IconTerminal } from './icons';

interface Props {
  installedVersion: string;
  release: { version: string; url: string; changelogHtml: string; publishedAt: string | null };
  onClose: () => void;
}

const UPDATE_COMMAND = 'cd ~/velix && git pull && sudo ./install.sh';

function CopyableCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-900/60">
      <IconTerminal className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-[12.5px] text-slate-700 dark:text-slate-200">{command}</code>
      <button
        onClick={copy}
        aria-label="Copiar comando"
        className="shrink-0 rounded-md p-1.5 text-slate-400 transition hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-100"
      >
        {copied ? <IconCheck className="h-4 w-4 text-green-500" aria-hidden /> : <IconCopy className="h-4 w-4" aria-hidden />}
      </button>
    </div>
  );
}

/**
 * O botão de atualizar entrega o comando, não executa a atualização.
 *
 * Atualizar o Velix significa reconstruir e reiniciar os containers em que a
 * própria API roda — de dentro de um deles, sem acesso ao Docker do host, isso
 * é impossível: o processo que dispara o rebuild morre no meio dele. Fazer de
 * verdade exige montar /var/run/docker.sock na API (equivale a root no host) e
 * um container efêmero que faça a troca de fora. É uma decisão de arquitetura e
 * de segurança, não um detalhe de tela — até lá, o modal é honesto sobre o que
 * faz e tira do usuário a parte chata, que é lembrar o comando exato.
 */
export function UpdateModal({ installedVersion, release, onClose }: Props) {
  return (
    <Modal title={`Atualizar para v${release.version}`} onClose={onClose} maxWidth="max-w-2xl">
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
          <div className="text-center">
            <p className="text-[11px] uppercase tracking-wide text-slate-400">Instalada</p>
            <p className="text-lg font-semibold text-slate-500">v{installedVersion}</p>
          </div>
          <IconDownload className="h-4 w-4 shrink-0 -rotate-90 text-slate-300 dark:text-slate-600" aria-hidden />
          <div className="text-center">
            <p className="text-[11px] uppercase tracking-wide text-slate-400">Nova</p>
            <p className="text-lg font-semibold text-indigo-500">v{release.version}</p>
          </div>
          <a
            href={release.url}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto text-xs text-indigo-500 hover:underline"
          >
            Ver no GitHub
          </a>
        </div>

        <div>
          <p className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">
            Rode no servidor, no diretório onde você clonou o Velix:
          </p>
          <CopyableCommand command={UPDATE_COMMAND} />
          <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
            O instalador é idempotente: preserva o <code>.env</code>, os volumes e o banco. O painel fica alguns minutos
            fora do ar durante o rebuild — os servidores gerenciados não são afetados.
          </p>
        </div>

        <Alert variant="info" title="Por que não é um clique só?">
          A atualização reconstrói e reinicia os containers em que esta API roda. De dentro deles, sem acesso ao Docker
          do host, o processo que dispara o rebuild morre no meio dele.
        </Alert>

        {release.changelogHtml && (
          <details className="group rounded-lg border border-slate-200 dark:border-slate-700" open>
            <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-slate-500 marker:text-slate-400 dark:text-slate-400">
              O que muda nesta versão
            </summary>
            <div
              className="changelog-body max-h-72 overflow-y-auto border-t border-slate-200 px-3 py-3 text-sm leading-relaxed text-slate-600 dark:border-slate-700 dark:text-slate-300"
              dangerouslySetInnerHTML={{ __html: release.changelogHtml }}
            />
          </details>
        )}

        <div className="flex justify-end">
          <button onClick={onClose} className="btn-secondary px-4 py-2 text-sm">
            Fechar
          </button>
        </div>
      </div>
    </Modal>
  );
}
