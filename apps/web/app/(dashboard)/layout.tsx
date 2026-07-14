'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { getToken } from '@/lib/api';
import { Sidebar } from '@/components/Sidebar';
import { ThemeToggle } from '@/components/ThemeToggle';

const PAGE_TITLES: Record<string, string> = {
  dashboard: 'Dashboard',
  servers: 'Servidores',
  settings: 'Configurações',
  databases: 'Banco de dados',
};

function pageTitleFor(pathname: string | null) {
  const segment = pathname?.split('/').filter(Boolean)[0];
  return (segment && PAGE_TITLES[segment]) ?? 'Velix';
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
    } else {
      setChecked(true);
    }
  }, [router]);

  if (!checked) return null;

  return (
    <div className="flex">
      <Sidebar />
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200/80 bg-white/80 px-4 py-3 backdrop-blur-md dark:border-slate-800/80 dark:bg-slate-900/80 md:px-6">
          <h1 className="text-sm font-medium text-slate-500">{pageTitleFor(pathname)}</h1>
          <ThemeToggle />
        </header>
        <main className="p-4 pb-24 md:p-6 md:pb-6">{children}</main>
      </div>
    </div>
  );
}
