'use client';

import { forwardRef, useId, useState } from 'react';
import { IconLock, IconEye, IconEyeOff } from '../icons';

interface Props {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: 'current-password' | 'new-password';
  autoFocus?: boolean;
  invalid?: boolean;
  errorMessage?: string;
  required?: boolean;
}

export const PasswordInput = forwardRef<HTMLInputElement, Props>(function PasswordInput(
  { label, value, onChange, autoComplete = 'current-password', autoFocus, invalid, errorMessage, required = true },
  ref,
) {
  const [visible, setVisible] = useState(false);
  const inputId = useId();
  const errorId = useId();

  return (
    <div>
      <label htmlFor={inputId} className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
        {label}
      </label>
      <div className="relative">
        <IconLock aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          ref={ref}
          id={inputId}
          type={visible ? 'text' : 'password'}
          required={required}
          autoFocus={autoFocus}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid && errorMessage ? errorId : undefined}
          className={`input pl-9 pr-11 ${invalid ? 'border-red-400 focus:border-red-500 focus:ring-red-500/20 dark:border-red-500/60' : ''}`}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'}
          aria-pressed={visible}
          className="absolute right-0 top-0 flex h-full w-10 items-center justify-center text-slate-400 transition hover:text-slate-600 dark:hover:text-slate-300"
          tabIndex={-1}
        >
          {visible ? <IconEyeOff className="h-4 w-4" /> : <IconEye className="h-4 w-4" />}
        </button>
      </div>
      {invalid && errorMessage && (
        <p id={errorId} role="alert" className="mt-1.5 text-xs text-red-500">
          {errorMessage}
        </p>
      )}
    </div>
  );
});
