'use client';

import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { Alert } from './Alert';
import { Modal } from './Modal';
import { Skeleton } from './Skeleton';

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
 *
 * Modal aberto a partir do menu da conta (ver Sidebar/MoreMenuDrawer) em vez
 * de morar fixo em Configurações → Segurança — é uma ação ("preciso parear
 * meu celular agora"), não uma configuração de segurança da conta.
 */
export function MobilePairingModal({ onClose }: { onClose: () => void }) {
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
      .then((QR) => QR.toDataURL(payload, { margin: 1, width: 240 }))
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

  // Gera assim que o modal abre — o modal inteiro existe pra mostrar o QR,
  // não faz sentido exigir mais um clique depois de já ter aberto por isso.
  useEffect(() => {
    generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const expired = ticket !== null && secondsLeft <= 0;

  return (
    <Modal title="App móvel" onClose={onClose} maxWidth="max-w-sm">
      <p className="mb-4 text-xs text-slate-400">
        Escaneie pelo app Velix (iOS ou Android) pra entrar sem digitar domínio, e-mail ou senha.
      </p>

      {error && (
        <div className="mb-3">
          <Alert variant="error">{error}</Alert>
        </div>
      )}

      {!ticket && !error && <Skeleton className="h-56" />}

      {ticket && (
        <div className="space-y-3 rounded-xl border border-slate-200 p-4 text-center dark:border-slate-700">
          {qr && !expired ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt="QR code de pareamento do app móvel" className="mx-auto rounded-lg bg-white p-2" />
          ) : (
            !expired && (
              <div className="mx-auto h-[240px] w-[240px]">
                <Skeleton className="h-full w-full" />
              </div>
            )
          )}
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {expired
              ? 'Este QR code expirou.'
              : `Abra o app, toque em "Escanear QR code" e aponte a câmera. Expira em ${secondsLeft}s.`}
          </p>
          <button onClick={generate} disabled={busy} className="btn-secondary px-3 py-1.5 text-xs">
            {busy ? 'Gerando...' : 'Gerar novo'}
          </button>
        </div>
      )}
    </Modal>
  );
}
