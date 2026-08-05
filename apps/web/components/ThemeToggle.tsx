'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { IconSun, IconMoon } from './icons';

export function ThemeToggle() {
  // ponytail-bugfix: comparar com `theme` exigia dois cliques. Enquanto o
  // usuário nunca escolheu um tema, `theme` vale "system" — nunca "dark" —
  // então o primeiro clique gravava justamente o tema que já estava na tela e
  // nada mudava. `resolvedTheme` é o tema realmente aplicado, inclusive quando
  // veio da preferência do sistema.
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div className="h-8 w-8" />;

  const isDark = resolvedTheme === 'dark';

  return (
    <button
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      aria-label={isDark ? 'Ativar tema claro' : 'Ativar tema escuro'}
      title={isDark ? 'Ativar tema claro' : 'Ativar tema escuro'}
      className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
    >
      {isDark ? <IconSun className="h-4 w-4" aria-hidden /> : <IconMoon className="h-4 w-4" aria-hidden />}
    </button>
  );
}
