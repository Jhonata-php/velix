'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { clearToken, getUser, type StoredUser } from '@/lib/api';
import { useUpdateStatus } from '@/lib/useUpdateStatus';
import { IconDashboard, IconServer, IconSettings, IconLogout, IconStore, IconDownload } from './icons';

const LINKS = [
  { href: '/dashboard', label: 'Dashboard', description: 'Visão geral da infraestrutura', icon: IconDashboard },
  { href: '/servers', label: 'Servidores', description: 'Cadastro e monitoramento', icon: IconServer },
  { href: '/library', label: 'Biblioteca', description: 'Catálogo de aplicações', icon: IconStore },
  { href: '/updates', label: 'Atualizações', description: 'Versão instalada e releases', icon: IconDownload },
  { href: '/settings', label: 'Configurações', description: 'Sistema e integrações', icon: IconSettings },
];

function roleLabel(role: string) {
  if (role === 'admin') return 'Administrador';
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function useLoggedUser() {
  const [user, setUserState] = useState<StoredUser | null>(null);
  useEffect(() => setUserState(getUser()), []);
  return user;
}

function useLogout() {
  const router = useRouter();
  return () => {
    clearToken();
    router.push('/login');
  };
}

function Avatar({ user }: { user: StoredUser }) {
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-indigo-700 text-sm font-semibold text-white">
      {user.name.charAt(0).toUpperCase()}
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const user = useLoggedUser();
  const logout = useLogout();
  const updateStatus = useUpdateStatus();
  const updateAvailable = !!updateStatus?.updateAvailable;

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  return (
    <>
      {/* Desktop: trilha de ícones fixa, com submenu flutuante ao passar o mouse */}
      <aside className="sticky top-0 hidden h-screen w-[72px] shrink-0 [transform:translateZ(0)] flex-col items-center border-r border-slate-200 bg-white py-4 dark:border-slate-700 dark:bg-slate-950 md:flex">
        <div className="mb-4 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-indigo-700 text-sm font-bold text-white shadow-md shadow-indigo-500/30">
          V
        </div>

        <nav className="flex flex-1 flex-col items-center gap-1.5">
          {LINKS.map((link) => {
            const active = pathname?.startsWith(link.href);
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`group relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition ${
                  active
                    ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400'
                    : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800/60'
                }`}
              >
                {active && <span className="absolute -left-2.5 h-4 w-0.5 rounded-full bg-indigo-500" />}
                <Icon className="h-[18px] w-[18px]" />
                {link.href === '/updates' && updateAvailable && (
                  <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-amber-500" />
                )}
                {/* Submenu contextual: aparece ao lado ao passar o mouse */}
                <span className="pointer-events-none absolute left-full top-1/2 z-30 ml-3 w-52 -translate-y-1/2 translate-x-1 rounded-lg border border-slate-200 bg-white p-3 opacity-0 shadow-lg transition group-hover:translate-x-0 group-hover:opacity-100 dark:border-slate-700 dark:bg-slate-800">
                  <span className="block text-sm font-medium text-slate-900 dark:text-slate-100">{link.label}</span>
                  <span className="mt-0.5 block text-xs text-slate-400">{link.description}</span>
                </span>
              </Link>
            );
          })}
        </nav>

        {user && (
          <div ref={menuRef} className="relative mt-3">
            {menuOpen && (
              <div className="absolute bottom-0 left-full z-30 ml-3 w-48 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800">
                <div className="border-b border-slate-100 px-4 py-2.5 dark:border-slate-700">
                  <span className="block truncate text-sm font-medium">{user.name}</span>
                  <span className="block truncate text-xs text-slate-400">{roleLabel(user.role)}</span>
                </div>
                <button
                  onClick={logout}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  <IconLogout className="h-4 w-4" />
                  Sair
                </button>
              </div>
            )}
            <button onClick={() => setMenuOpen((v) => !v)} title={user.name}>
              <Avatar user={user} />
            </button>
          </div>
        )}
      </aside>

      {/* Mobile: barra de navegação fixa embaixo */}
      <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] dark:border-slate-700 dark:bg-slate-900 md:hidden">
        {LINKS.map((link) => {
          const active = pathname?.startsWith(link.href);
          const Icon = link.icon;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] ${
                active ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              <span className="relative">
                <Icon className="h-5 w-5" />
                {link.href === '/updates' && updateAvailable && (
                  <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-amber-500" />
                )}
              </span>
              {link.label}
            </Link>
          );
        })}
        <button onClick={logout} className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] text-slate-500 dark:text-slate-400">
          <IconLogout className="h-5 w-5" />
          Sair
        </button>
      </nav>
    </>
  );
}
