'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useUpdateStatus } from '@/lib/useUpdateStatus';
import { IconDashboard, IconServer, IconStore, IconDownload, IconMenu } from '../icons';

const ITEMS = [
  { href: '/dashboard', label: 'Início', icon: IconDashboard },
  { href: '/servers', label: 'Servidores', icon: IconServer },
  { href: '/library', label: 'Aplicações', icon: IconStore },
  { href: '/updates', label: 'Atualizações', icon: IconDownload },
] as const;

export function MobileBottomNav({ onOpenMore, moreActive }: { onOpenMore: () => void; moreActive: boolean }) {
  const pathname = usePathname();
  const updateStatus = useUpdateStatus();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-20 flex border-t border-slate-200/80 bg-white/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md dark:border-slate-700/80 dark:bg-slate-950/90 md:hidden"
      aria-label="Navegação principal"
    >
      {ITEMS.map((item) => {
        const active = pathname?.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`relative flex flex-1 flex-col items-center gap-1 py-2 text-[11px] font-medium transition active:scale-95 ${
              active ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <span className="relative">
              <Icon className="h-5 w-5" aria-hidden />
              {item.href === '/updates' && updateStatus?.updateAvailable && (
                <span aria-hidden className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-amber-500" />
              )}
            </span>
            {item.label}
          </Link>
        );
      })}
      <button
        onClick={onOpenMore}
        aria-expanded={moreActive}
        className={`flex flex-1 flex-col items-center gap-1 py-2 text-[11px] font-medium transition active:scale-95 ${
          moreActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-slate-400'
        }`}
      >
        <IconMenu className="h-5 w-5" aria-hidden />
        Mais
      </button>
    </nav>
  );
}
