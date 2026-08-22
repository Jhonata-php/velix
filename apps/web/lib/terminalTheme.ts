import type { ITheme } from '@xterm/xterm';

// Cinza neutro (sem matiz de azul) — o slate usado antes lia como "terminal
// azul" pra quem via de relance, mesmo sendo bem escuro.
const DARK_THEME: ITheme = {
  background: '#171717',
  foreground: '#e5e5e5',
  cursor: '#e5e5e5',
  cursorAccent: '#171717',
  selectionBackground: '#ffffff26',
  black: '#171717',
  red: '#f87171',
  green: '#4ade80',
  yellow: '#fbbf24',
  blue: '#60a5fa',
  magenta: '#c084fc',
  cyan: '#22d3ee',
  white: '#e5e5e5',
  brightBlack: '#525252',
  brightRed: '#fca5a5',
  brightGreen: '#86efac',
  brightYellow: '#fde68a',
  brightBlue: '#93c5fd',
  brightMagenta: '#d8b4fe',
  brightCyan: '#67e8f9',
  brightWhite: '#fafafa',
};

// Fundo branco, letra preta — pedido explícito no modo claro, em vez de um
// terminal sempre escuro por cima de uma página clara.
const LIGHT_THEME: ITheme = {
  background: '#ffffff',
  foreground: '#0f172a',
  cursor: '#4f46e5',
  cursorAccent: '#ffffff',
  selectionBackground: '#4f46e533',
  black: '#0f172a',
  red: '#dc2626',
  green: '#16a34a',
  yellow: '#ca8a04',
  blue: '#2563eb',
  magenta: '#9333ea',
  cyan: '#0891b2',
  white: '#64748b',
  brightBlack: '#475569',
  brightRed: '#ef4444',
  brightGreen: '#22c55e',
  brightYellow: '#eab308',
  brightBlue: '#3b82f6',
  brightMagenta: '#a855f7',
  brightCyan: '#06b6d4',
  brightWhite: '#0f172a',
};

export function getTerminalTheme(isDark: boolean): ITheme {
  return isDark ? DARK_THEME : LIGHT_THEME;
}
