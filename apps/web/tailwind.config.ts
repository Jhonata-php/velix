import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Sobrescreve as paletas "slate" e "indigo" padrão do Tailwind — como o
      // app inteiro já usa classes slate-*/indigo-*, isso aplica a identidade
      // visual (neutros quase-pretos + violeta Velix) em todo canto sem editar
      // cada arquivo. slate-700 é o token de borda (distinto de 800/900, que
      // são superfícies), slate-950 é o fundo geral do app.
      colors: {
        slate: {
          50: '#f7f7f7',
          100: '#ececec',
          200: '#dcdcdc',
          300: '#c4c4c4',
          400: '#9c9c9c',
          500: '#767676',
          600: '#5a5a5a',
          700: '#2a2a2e',
          800: '#1c1c1f',
          900: '#111113',
          950: '#09090b',
        },
        indigo: {
          50: '#f2f0ff',
          100: '#e4e0ff',
          200: '#c9c2ff',
          300: '#a99cff',
          400: '#8f7cff',
          500: '#7c6cff',
          600: '#6d5dfc',
          700: '#5b4dd6',
          800: '#4a3fb0',
          900: '#3d3494',
        },
      },
    },
  },
  plugins: [],
};

export default config;
