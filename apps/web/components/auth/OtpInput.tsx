'use client';

import { useEffect, useRef, useState } from 'react';

export type OtpState = 'idle' | 'verifying' | 'success' | 'error';

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** Chamado quando os 6 dígitos ficam preenchidos — evita obrigar o usuário a
   * tirar a mão do teclado pra clicar em "verificar". */
  onComplete?: (value: string) => void;
  state: OtpState;
  length?: number;
  disabled?: boolean;
}

/**
 * Campo de código de verificação em caixas separadas.
 *
 * Um `<input>` único aceita o código, mas erra em três coisas que importam
 * justo aqui: não dá para ver quantos dígitos faltam, colar do gerenciador de
 * senhas frequentemente traz espaços ou hífen, e o teclado do celular abre em
 * modo texto. As caixas resolvem os três, e o estado visual (conferindo, ok,
 * recusado) responde na hora — num campo de segurança, tela parada por dois
 * segundos é lida como falha.
 *
 * Só o primeiro campo entra na ordem de tabulação: navegar por Tab dígito a
 * dígito é pior que digitar direto, e o avanço automático já cuida do foco.
 */
export function OtpInput({ value, onChange, onComplete, state, length = 6, disabled }: Props) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const [focused, setFocused] = useState(0);
  const digits = value.padEnd(length, ' ').slice(0, length).split('');

  useEffect(() => {
    if (state === 'error') refs.current[0]?.focus();
  }, [state]);

  function setDigit(index: number, char: string) {
    const next = digits.map((d, i) => (i === index ? char : d)).join('').replace(/\s/g, ' ');
    const cleaned = next.replace(/\s+$/, '');
    onChange(cleaned);
    if (cleaned.replace(/\s/g, '').length === length && !cleaned.includes(' ')) onComplete?.(cleaned);
  }

  function handleChange(index: number, raw: string) {
    const only = raw.replace(/\D/g, '');
    if (!only) return;

    // Colar o código inteiro em qualquer caixa distribui pelos campos — é assim
    // que gerenciadores de senha e o preenchimento automático do iOS entregam.
    if (only.length > 1) {
      const filled = only.slice(0, length);
      onChange(filled);
      const target = Math.min(filled.length, length - 1);
      refs.current[target]?.focus();
      if (filled.length === length) onComplete?.(filled);
      return;
    }

    setDigit(index, only);
    if (index < length - 1) refs.current[index + 1]?.focus();
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace') {
      e.preventDefault();
      // Apagar num campo vazio volta e apaga o anterior: é o que a pessoa espera
      // ao corrigir, e evita ter que clicar de volta.
      if (digits[index].trim()) setDigit(index, ' ');
      else if (index > 0) {
        setDigit(index - 1, ' ');
        refs.current[index - 1]?.focus();
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      refs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < length - 1) {
      refs.current[index + 1]?.focus();
    }
  }

  if (state === 'success') {
    return (
      <div className="velix-otp__success flex h-[52px] items-center justify-center gap-2 rounded-xl border border-green-500/40 bg-green-500/10">
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="rgb(74 222 128)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path className="velix-otp__check" d="M4 12.5l5 5L20 6.5" />
        </svg>
        <span className="text-sm font-medium text-green-400">Código confirmado</span>
      </div>
    );
  }

  return (
    <div
      className={`velix-otp flex gap-2 rounded-xl ${state === 'verifying' ? 'velix-otp--verifying' : ''} ${
        state === 'error' ? 'velix-otp--error' : ''
      }`}
    >
      {Array.from({ length }, (_, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={digits[i].trim()}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onFocus={(e) => {
            setFocused(i);
            e.target.select();
          }}
          disabled={disabled || state === 'verifying'}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={length}
          aria-label={`Dígito ${i + 1} de ${length}`}
          tabIndex={i === 0 ? 0 : -1}
          className={`h-[52px] w-full rounded-xl border bg-white/5 text-center font-mono text-xl font-semibold text-slate-100 outline-none transition ${
            state === 'error'
              ? 'border-red-500/60'
              : focused === i
                ? 'border-indigo-400 ring-2 ring-indigo-500/25'
                : digits[i].trim()
                  ? 'border-slate-600'
                  : 'border-slate-700'
          } disabled:opacity-60`}
        />
      ))}
    </div>
  );
}
