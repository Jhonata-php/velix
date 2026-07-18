'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, setToken, setUser } from '@/lib/api';
import { Modal } from '@/components/Modal';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return; // evita duplo submit (ex.: Enter + clique quase simultâneos)
    setError(null);
    setLoading(true);
    try {
      const data = await apiFetch<{ accessToken: string; user: { name: string; email: string; role: string } }>('/auth/login', {
        method: 'POST',
        // E-mail é normalizado; a senha é enviada exatamente como digitada
        // (trim() cortaria um espaço que pode ser parte real da senha).
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
      setToken(data.accessToken);
      setUser(data.user);
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha no login');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-50 dark:bg-slate-950">
      {/* Blobs à deriva — só decoração, então aria-hidden; cada um com seu
          próprio período pra não sincronizar e parecer um "respirar" mecânico. */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="animate-blob-1 absolute -left-24 -top-24 h-[28rem] w-[28rem] rounded-full bg-indigo-500/25 blur-3xl dark:bg-indigo-500/20" />
        <div className="animate-blob-2 absolute -right-24 top-1/3 h-[26rem] w-[26rem] rounded-full bg-fuchsia-500/15 blur-3xl dark:bg-fuchsia-500/15" />
        <div className="animate-blob-3 absolute -bottom-32 left-1/3 h-[30rem] w-[30rem] rounded-full bg-cyan-400/10 blur-3xl dark:bg-cyan-400/10" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(99,102,241,0.12),transparent_60%)]" />
      </div>

      <form onSubmit={handleSubmit} className="card animate-card-rise relative z-10 w-full max-w-sm p-8 shadow-2xl">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="relative mb-4 h-12 w-12">
            <div className="animate-logo-glow absolute inset-0 rounded-2xl bg-indigo-500 blur-lg" />
            <div className="animate-logo-pop relative flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-700 text-xl font-bold text-white shadow-lg shadow-indigo-500/30">
              V
            </div>
          </div>
          <h1 className="animate-fade-up text-2xl font-semibold tracking-tight [animation-delay:100ms]">Velix</h1>
          <p className="animate-fade-up mt-1 text-sm text-slate-500 [animation-delay:180ms]">Controle. Continuidade. Disponibilidade.</p>
        </div>

        <div className="animate-fade-up [animation-delay:240ms]">
          <label className="mb-1 block text-sm font-medium">E-mail</label>
          <input
            type="email"
            required
            autoFocus
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input mb-4"
          />
        </div>

        <div className="animate-fade-up [animation-delay:300ms]">
          <label className="mb-1 block text-sm font-medium">Senha</label>
          <div className="relative mb-2">
            <input
              type={showPassword ? 'text' : 'password'}
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input pr-16"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute inset-y-0 right-0 px-3 text-xs font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
              tabIndex={-1}
            >
              {showPassword ? 'Ocultar' : 'Mostrar'}
            </button>
          </div>
        </div>

        <div className="mb-4 flex justify-end">
          <button
            type="button"
            onClick={() => setForgotOpen(true)}
            className="text-xs font-medium text-indigo-500 hover:text-indigo-400 hover:underline"
          >
            Esqueci minha senha
          </button>
        </div>

        {error && <p className="mb-4 text-sm text-red-500">{error}</p>}

        <button type="submit" disabled={loading} className="animate-fade-up w-full btn-primary px-3 py-2 text-sm [animation-delay:360ms]">
          {loading ? 'Entrando...' : 'Entrar'}
        </button>
      </form>

      {forgotOpen && (
        <Modal title="Esqueci minha senha" onClose={() => setForgotOpen(false)} maxWidth="max-w-sm">
          <p className="mb-3 text-sm text-slate-500">
            O Velix ainda não envia e-mails de redefinição automaticamente. Peça a um administrador do sistema para
            redefinir sua senha executando, no servidor:
          </p>
          <pre className="mb-3 overflow-x-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">
            npm run admin:reset-password -- --email {email.trim() || 'seu@email.com'}
          </pre>
          <p className="text-xs text-slate-400">Assim que a senha for redefinida, entre novamente com a nova senha.</p>
        </Modal>
      )}
    </div>
  );
}
