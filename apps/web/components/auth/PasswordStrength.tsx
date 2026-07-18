// Feedback visual enquanto o usuário digita — a validação de verdade (que
// decide se a senha é aceita) é sempre a do backend (password-policy.util.ts).
// Duplicar a heurística aqui evita uma requisição de rede a cada tecla digitada.
function score(password: string): 0 | 1 | 2 | 3 | 4 {
  let s = 0;
  if (password.length >= 12) s++;
  if (password.length >= 16) s++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) s++;
  if (/\d/.test(password)) s++;
  if (/[^A-Za-z0-9]/.test(password)) s++;
  return Math.min(4, Math.max(0, s - 1)) as 0 | 1 | 2 | 3 | 4;
}

const LABELS = ['Muito fraca', 'Fraca', 'Razoável', 'Forte', 'Muito forte'];
const COLORS = ['bg-red-500', 'bg-orange-500', 'bg-amber-500', 'bg-lime-500', 'bg-green-500'];

const REQUIREMENTS: { test: (p: string) => boolean; label: string }[] = [
  { test: (p) => p.length >= 12, label: 'Pelo menos 12 caracteres' },
  { test: (p) => /[a-z]/.test(p) && /[A-Z]/.test(p), label: 'Letra maiúscula e minúscula' },
  { test: (p) => /\d/.test(p), label: 'Um número' },
  { test: (p) => /[^A-Za-z0-9]/.test(p), label: 'Um caractere especial' },
];

export function PasswordStrength({ password }: { password: string }) {
  if (!password) return null;
  const s = score(password);

  return (
    <div className="mt-2">
      <div className="flex gap-1" role="presentation">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${i <= s ? COLORS[s] : 'bg-slate-200 dark:bg-slate-700'}`} />
        ))}
      </div>
      <p className="mt-1 text-xs text-slate-500">{LABELS[s]}</p>
      <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
        {REQUIREMENTS.map((req) => {
          const met = req.test(password);
          return (
            <li key={req.label} className={`flex items-center gap-1.5 text-xs ${met ? 'text-green-600 dark:text-green-400' : 'text-slate-400'}`}>
              <span aria-hidden className={`h-1 w-1 rounded-full ${met ? 'bg-green-500' : 'bg-slate-300 dark:bg-slate-600'}`} />
              {req.label}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
