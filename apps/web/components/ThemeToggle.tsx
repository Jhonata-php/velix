'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div className="h-8 w-8" />;

  return (
    <button
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
      title="Alternar tema"
    >
      {theme === 'dark' ? '☀️' : '🌙'}
    </button>
  );
}
