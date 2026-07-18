import { ReactNode } from 'react';
import { AuthVisualPanel } from './AuthVisualPanel';

// Layout compartilhado por /login, /forgot-password e /reset-password —
// painel institucional à esquerda (55-60%) só em telas >= lg, formulário à
// direita (38-45%) sempre visível. Em mobile o painel some e o formulário
// ocupa a tela inteira (não é o mesmo layout "espremido").
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-slate-50 pt-[env(safe-area-inset-top)] dark:bg-slate-950">
      <AuthVisualPanel />
      <div className="relative flex w-full flex-1 items-center justify-center overflow-hidden px-4 py-10 sm:px-8 lg:w-[42%] xl:w-[40%]">
        <div aria-hidden className="pointer-events-none absolute inset-0 lg:hidden">
          <div className="animate-blob-1 absolute -left-24 -top-24 h-[24rem] w-[24rem] rounded-full bg-indigo-500/20 blur-3xl dark:bg-indigo-500/15" />
          <div className="animate-blob-2 absolute -right-24 bottom-0 h-[22rem] w-[22rem] rounded-full bg-fuchsia-500/15 blur-3xl dark:bg-fuchsia-500/10" />
        </div>
        <div className="relative z-10 w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
