'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { Alert } from './Alert';
import { IconShield, IconCopy, IconCheck } from './icons';

interface TotpStatus {
  enabled: boolean;
  enabledAt: string | null;
  recoveryCodesRemaining: number;
}

/**
 * Verificação em duas etapas.
 *
 * Os códigos de recuperação aparecem uma única vez, na confirmação — depois
 * disso só existem como hash no banco. Por isso a tela obriga a confirmar que
 * foram guardados antes de fechar: perder os oito e o celular ao mesmo tempo
 * significa perder o acesso a um painel que controla o SSH de todos os
 * servidores.
 */
export function TwoFactorCard() {
  const [status, setStatus] = useState<TotpStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [disabling, setDisabling] = useState(false);
  const [password, setPassword] = useState('');

  function load() {
    apiFetch<TotpStatus>('/auth/2fa').then(setStatus).catch(() => {});
  }
  useEffect(load, []);

  // QR gerado no navegador: a URI carrega o segredo, e mandá-la para um serviço
  // externo de QR entregaria o segundo fator a terceiros.
  useEffect(() => {
    if (!setup) return;
    import('qrcode')
      .then((QR) => QR.toDataURL(setup.otpauthUrl, { margin: 1, width: 220 }))
      .then(setQr)
      .catch(() => setQr(null));
  }, [setup]);

  async function begin() {
    setBusy(true);
    setError(null);
    try {
      setSetup(await apiFetch<{ secret: string; otpauthUrl: string }>('/auth/2fa/begin', { method: 'POST' }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao iniciar');
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ recoveryCodes: string[] }>('/auth/2fa/confirm', {
        method: 'POST',
        body: JSON.stringify({ code }),
      });
      setRecoveryCodes(res.recoveryCodes);
      setSetup(null);
      setCode('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Código inválido');
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/auth/2fa/disable', { method: 'POST', body: JSON.stringify({ password }) });
      setDisabling(false);
      setPassword('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao desativar');
    } finally {
      setBusy(false);
    }
  }

  async function copyCodes() {
    if (!recoveryCodes) return;
    await navigator.clipboard.writeText(recoveryCodes.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <section className="card p-4">
      <div className="flex items-start gap-3">
        <span className="icon-chip bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
          <IconShield className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="section-title">Verificação em duas etapas</h2>
          <p className="mt-0.5 text-xs text-slate-400">
            {status?.enabled
              ? `Ativa · ${status.recoveryCodesRemaining} código${status.recoveryCodesRemaining === 1 ? '' : 's'} de recuperação restante${status.recoveryCodesRemaining === 1 ? '' : 's'}`
              : 'Um código do celular além da senha. Recomendado — este painel tem acesso SSH aos seus servidores.'}
          </p>
        </div>
        {status && !status.enabled && !setup && (
          <button onClick={begin} disabled={busy} className="btn-primary shrink-0 px-3 py-1.5 text-xs">
            Ativar
          </button>
        )}
        {status?.enabled && !disabling && (
          <button onClick={() => setDisabling(true)} className="btn-secondary shrink-0 px-3 py-1.5 text-xs">
            Desativar
          </button>
        )}
      </div>

      {error && (
        <div className="mt-3">
          <Alert variant="error">{error}</Alert>
        </div>
      )}

      {setup && (
        <div className="mt-4 space-y-3 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Leia o QR no seu app autenticador (Google Authenticator, Authy, 1Password) e digite o código de 6 dígitos.
          </p>
          {qr && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt="QR code da verificação em duas etapas" className="mx-auto rounded-lg bg-white p-2" />
          )}
          <details className="text-xs text-slate-400">
            <summary className="cursor-pointer">Não consigo ler o QR</summary>
            <p className="mt-1.5">
              Digite este código manualmente: <code className="font-mono text-slate-600 dark:text-slate-300">{setup.secret}</code>
            </p>
          </details>
          <div className="flex gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="000000"
              inputMode="numeric"
              className="input font-mono tracking-widest"
            />
            <button onClick={confirm} disabled={busy || code.length < 6} className="btn-primary shrink-0 px-4 py-2 text-sm">
              Confirmar
            </button>
          </div>
        </div>
      )}

      {recoveryCodes && (
        <div className="mt-4 rounded-xl border border-amber-300/60 bg-amber-50 p-4 dark:border-amber-800/60 dark:bg-amber-900/15">
          <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Guarde os códigos de recuperação</p>
          <p className="mt-1 text-xs leading-relaxed text-amber-700/90 dark:text-amber-400/80">
            Cada um serve uma vez, se você perder o celular. Esta é a única vez que eles aparecem — depois disso ficam
            guardados só como hash e nem o Velix consegue mostrá-los de novo.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-1.5 rounded-lg bg-white/70 p-3 font-mono text-xs dark:bg-slate-900/50">
            {recoveryCodes.map((c) => (
              <span key={c} className="text-slate-800 dark:text-slate-100">
                {c}
              </span>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button onClick={copyCodes} className="btn-secondary flex items-center gap-1.5 px-3 py-1.5 text-xs">
              {copied ? <IconCheck className="h-3.5 w-3.5 text-green-500" /> : <IconCopy className="h-3.5 w-3.5" />}
              {copied ? 'Copiados' : 'Copiar todos'}
            </button>
            <label className="flex items-center gap-1.5 text-xs text-amber-800 dark:text-amber-300">
              <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
              Guardei em lugar seguro
            </label>
            <button
              onClick={() => setRecoveryCodes(null)}
              disabled={!saved}
              className="btn-primary ml-auto px-3 py-1.5 text-xs disabled:opacity-40"
            >
              Fechar
            </button>
          </div>
        </div>
      )}

      {disabling && (
        <div className="mt-4 space-y-2 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
          <p className="text-sm text-slate-600 dark:text-slate-300">Confirme sua senha para desativar.</p>
          <div className="flex gap-2">
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="input" />
            <button onClick={disable} disabled={busy || !password} className="btn-danger shrink-0 px-4 py-2 text-sm">
              Desativar
            </button>
            <button onClick={() => setDisabling(false)} className="btn-secondary shrink-0 px-4 py-2 text-sm">
              Cancelar
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
