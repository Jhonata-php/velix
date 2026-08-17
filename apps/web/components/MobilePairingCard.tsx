'use client';

import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { Alert } from './Alert';
import { IconDevice } from './icons';

interface PairingTicket {
  token: string;
  expiresAt: string;
  ttlSeconds: number;
}

/**
 * QR code pra parear o app iOS/Android sem digitar domínio, e-mail e senha —
 * a pessoa já está logada aqui, então o QR carrega um token de uso único e
 * vida curta (ver DevicePairingTokenService na API) que o app troca por uma
 * sessão de verdade em `/auth/pairing/redeem`. O QR é gerado no navegador
 * (mesmo motivo do TwoFactorCard): mandar o payload pra um serviço externo
 * de QR entregaria o token de login a terceiros.
 */
export function MobilePairingCard() {
  const [ticket, setTicket] = useState<PairingTicket | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (tickRef.current) clearInterval(tickRef.current); }, []);

  useEffect(() => {
    if (!ticket) {
      setQr(null);
      return;
    }
    const payload = JSON.stringify({ baseUrl: window.location.origin, token: ticket.token });
    import('qrcode')
      .then((QR) => QR.toDataURL(payload, { margin: 1, width: 220 }))
      .then(setQr)
      .catch(() => setQr(null));
  }, [ticket]);

  async function generate() {
    setBusy(true);
    setError(null);
    if (tickRef.current) clearInterval(tickRef.current);
    try {
      const next = await apiFetch<PairingTicket>('/auth/pairing/start', { method: 'POST' });
      setTicket(next);
      setSecondsLeft(next.ttlSeconds);
      tickRef.current = setInterval(() => {
        setSecondsLeft((s) => {
          if (s <= 1 && tickRef.current) clearInterval(tickRef.current);
          return Math.max(0, s - 1);
        });
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao gerar QR code');
    } finally {
      setBusy(false);
    }
  }

  const expired = ticket !== null && secondsLeft <= 0;

  return (
    <section className="card p-5">
      <div className="flex items-start gap-3">
        <span className="icon-chip bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
          <IconDevice className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="section-title">App móvel</h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Escaneie pelo app Velix (iOS ou Android) pra entrar sem digitar domínio, e-mail ou senha.
          </p>
        </div>
        {!ticket && (
          <button onClick={generate} disabled={busy} className="btn-primary shrink-0 px-3 py-1.5 text-xs">
            {busy ? 'Gerando...' : 'Gerar QR code'}
          </button>
        )}
      </div>

      {error && (
        <div className="mt-3">
          <Alert variant="error">{error}</Alert>
        </div>
      )}

      {ticket && (
        <div className="mt-4 space-y-3 rounded-xl border border-slate-200 p-4 text-center dark:border-slate-700">
          {qr && !expired && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt="QR code de pareamento do app móvel" className="mx-auto rounded-lg bg-white p-2" />
          )}
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {expired
              ? 'Este QR code expirou.'
              : `Abra o app, toque em "Escanear QR code" e aponte a câmera. Expira em ${secondsLeft}s.`}
          </p>
          <button
            onClick={generate}
            disabled={busy}
            className="btn-secondary px-3 py-1.5 text-xs"
          >
            {busy ? 'Gerando...' : 'Gerar novo'}
          </button>
        </div>
      )}
    </section>
  );
}
