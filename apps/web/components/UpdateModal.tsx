'use client';

import { useState } from 'react';
import { Modal } from './Modal';
import { Alert } from './Alert';
import { IconCopy, IconCheck, IconDownload, IconTerminal } from './icons';

interface Props {
  installedVersion: string;
  release: { version: string; url: string; changelogHtml: string; publishedAt: string | null };
  /** Falso em instalações anteriores ao recurso: a tela cai no passo a passo manual. */
  selfUpdateAvailable: boolean;
  applying: boolean;
  error: string | null;
  onApply: () => void;
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
 * Confirmação em dois passos de propósito: atualizar derruba o painel por
 * alguns minutos, e um clique acidental no cartão de destaque da tela inicial
 * não pode ser suficiente pra isso acontecer.
 *
 * O comando manual continua aqui mesmo quando o botão existe — instalação
 * quebrada no meio da atualização se conserta pelo terminal, e é justamente
 * nessa hora que ninguém lembra o comando.
 */
export function UpdateModal({ installedVersion, release, selfUpdateAvailable, applying, error, onApply, onClose }: Props) {
  const [confirming, setConfirming] = useState(false);

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

        {selfUpdateAvailable ? (
          <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
            {confirming ? (
              <>
                <p className="text-sm font-medium text-slate-800 dark:text-slate-100">Tem certeza que quer atualizar agora?</p>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  O painel sai do ar por alguns minutos enquanto os serviços são reconstruídos. Ninguém consegue usar o
                  Velix nesse período — os servidores gerenciados e as aplicações neles continuam rodando normalmente.
                </p>
                <div className="mt-3 flex gap-2">
                  <button onClick={() => setConfirming(false)} disabled={applying} className="btn-secondary px-3 py-1.5 text-xs">
                    Cancelar
                  </button>
                  <button onClick={onApply} disabled={applying} className="btn-primary px-3 py-1.5 text-xs">
                    {applying ? 'Enviando...' : 'Sim, atualizar agora'}
                  </button>
                </div>
              </>
            ) : (
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-100">Atualizar pelo painel</p>
                  <p className="text-xs text-slate-500">O servidor baixa, reconstrói e reinicia sozinho.</p>
                </div>
                <button onClick={() => setConfirming(true)} className="btn-primary shrink-0 px-4 py-2 text-sm">
                  Atualizar agora
                </button>
              </div>
            )}
            {error && (
              <div className="mt-3">
                <Alert variant="error">{error}</Alert>
              </div>
            )}
          </div>
        ) : (
          <Alert variant="info" title="Atualização pelo painel indisponível nesta instalação">
            Ela é configurada pelo instalador. Rode o comando abaixo uma vez e o botão passa a existir.
          </Alert>
        )}

        <div>
          <p className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">
            {selfUpdateAvailable ? 'Ou, se preferir fazer na mão, no servidor:' : 'No servidor, no diretório onde você clonou o Velix:'}
          </p>
          <CopyableCommand command={UPDATE_COMMAND} />
          <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
            O instalador é idempotente: preserva o <code>.env</code>, os volumes e o banco.
          </p>
        </div>

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
