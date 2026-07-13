import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Sobrescreve a paleta "slate" padrão do Tailwind (que puxa pro azul)
      // por um cinza neutro — como o app inteiro já usa classes slate-*,
      // isso muda a aparência em todo canto sem editar cada arquivo.
      colors: {
        slate: {
          50: '#f7f7f7',
          100: '#ececec',
          200: '#dcdcdc',
          300: '#c4c4c4',
          400: '#9c9c9c',
          500: '#767676',
          600: '#5a5a5a',
          700: '#454547',
          800: '#3a3a3c',
          900: '#2a2a2c',
          950: '#1e1e1f',
        },
      },
    },
  },
  plugins: [],
};

export default config;
