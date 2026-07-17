'use client';

import { useState } from 'react';
import { IconBox } from './icons';

interface Props {
  icon?: string | null;
  name: string;
  size?: 'sm' | 'md' | 'lg';
}

const SIZE_CLASS: Record<NonNullable<Props['size']>, string> = {
  sm: 'h-9 w-9 p-1.5',
  md: 'h-14 w-14 p-2',
  lg: 'h-16 w-16 p-3',
};

/** Logo real da aplicação num chip branco fixo (as marcas dos manifestos não
 * têm `fill`, então herdam preto — precisam de fundo claro em qualquer tema).
 * Sem logo (ou arquivo ausente): ícone genérico, nunca apenas as iniciais do nome. */
export function AppIcon({ icon, name, size = 'md' }: Props) {
  const [failed, setFailed] = useState(false);
  const showImage = icon && !failed;
  return (
    <span className={`flex shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white ${SIZE_CLASS[size]}`}>
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={icon} alt={`Logo ${name}`} className="h-full w-full object-contain" onError={() => setFailed(true)} />
      ) : (
        <IconBox className="h-full w-full text-slate-400" />
      )}
    </span>
  );
}
