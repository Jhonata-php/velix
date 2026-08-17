'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { apiFetch, getToken, setUser as persistUser, type StoredUser } from '@/lib/api';
import { Sidebar } from '@/components/Sidebar';
import { ThemeToggle } from '@/components/ThemeToggle';
import { MobileHeader } from '@/components/navigation/MobileHeader';
import { MobileBottomNav } from '@/components/navigation/MobileBottomNav';
import { MoreMenuDrawer } from '@/components/navigation/MoreMenuDrawer';
import { MobilePairingModal } from '@/components/MobilePairingModal';
import { UpdatingScreen } from '@/components/UpdatingScreen';
import { UpdateBanner } from '@/components/UpdateBanner';
import { SelfUpdateProvider, useSelfUpdate } from '@/lib/useSelfUpdate';

const PAGE_TITLES: Record<string, string> = {
  dashboard: 'Dashboard',
  servers: 'Servidores',
  settings: 'Configurações',
  databases: 'Banco de dados',
  library: 'Loja de Aplicativos',
  projects: 'Projetos',
  updates: 'Atualizações',
};

function pageTitleFor(pathname: string | null) {
  const segment = pathname?.split('/').filter(Boolean)[0];
  return (segment && PAGE_TITLES[segment]) ?? 'Velix';
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [checked, setChecked] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [user, setUser] = useState<StoredUser | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function validateSession() {
      if (!getToken()) {
        router.replace(`/login?next=${encodeURIComponent(pathname || '/dashboard')}`);
        return;
      }
      try {
        // Valida de verdade contra o backend (não só "existe um token no
        // localStorage") — pega token adulterado, sessão revogada em outro
        // lugar, ou usuário removido. apiFetch já cuida do redirect com
        // `next` preservado se der 401.
        const me = await apiFetch<StoredUser>('/auth/me');
        if (cancelled) return;
        persistUser(me);
        setUser(me);
        setChecked(true);
      } catch {
        // apiFetch já redirecionou em caso de 401; outros erros (rede,
        // timeout) não devem prender o usuário numa tela em branco pra sempre.
        if (!cancelled) router.replace(`/login?next=${encodeURIComponent(pathname || '/dashboard')}`);
      }
    }

    validateSession();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  if (!checked) return null;

  return (
    <SelfUpdateProvider>
      <DashboardShell pathname={pathname} user={user} moreOpen={moreOpen} setMoreOpen={setMoreOpen}>
        {children}
      </DashboardShell>
    </SelfUpdateProvider>
  );
}

/** Separado do layout porque precisa estar dentro do provider pra enxergar o
 * estado da atualização — um componente não consegue consumir um contexto que
 * ele mesmo monta. */
function DashboardShell({
  pathname,
  user,
  moreOpen,
  setMoreOpen,
  children,
}: {
  pathname: string | null;
  user: StoredUser | null;
  moreOpen: boolean;
  setMoreOpen: (v: boolean) => void;
  children: React.ReactNode;
}) {
  const selfUpdate = useSelfUpdate();
  const [mobilePairingOpen, setMobilePairingOpen] = useState(false);

  return (
    <div className="flex">
      <Sidebar />
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-10 hidden h-14 [transform:translateZ(0)] items-center justify-between border-b border-slate-200/80 bg-white/80 px-5 backdrop-blur-md dark:border-slate-700/80 dark:bg-slate-950/80 md:flex md:px-6">
          <h1 className="text-sm font-medium text-slate-500 dark:text-slate-400">{pageTitleFor(pathname)}</h1>
          <ThemeToggle />
        </header>
        <MobileHeader onOpenAccount={() => setMoreOpen(true)} />
        <main className="p-4 pb-24 md:p-6 md:pb-6">
          <UpdateBanner />
          {children}
        </main>
      </div>

      <MobileBottomNav onOpenMore={() => setMoreOpen(true)} moreActive={moreOpen} />
      {moreOpen && (
        <MoreMenuDrawer
          user={user}
          onClose={() => setMoreOpen(false)}
          onOpenMobilePairing={() => {
            setMoreOpen(false);
            setMobilePairingOpen(true);
          }}
        />
      )}
      {mobilePairingOpen && <MobilePairingModal onClose={() => setMobilePairingOpen(false)} />}

      {/* Fora do <main>: a atualização derruba o painel inteiro, então a tela
          cobre qualquer página em que o usuário estiver. */}
      {selfUpdate.active && (
        <UpdatingScreen fromVersion={selfUpdate.status?.fromVersion ?? '—'} onDismiss={selfUpdate.dismiss} />
      )}
    </div>
  );
}
