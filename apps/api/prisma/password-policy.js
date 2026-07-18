// Política de senha compartilhada entre prisma/seed.js e
// scripts/reset-admin-password.js — um lugar só, pra nunca divergir entre
// "criar admin" e "redefinir senha".
const WEAK_PASSWORDS = new Set(['changeme123', 'password', 'admin123', '12345678', 'senha123', 'velix1234', 'administrador']);

/** Retorna uma mensagem de erro em string, ou null se a senha for aceitável. */
function validatePassword(password, email) {
  if (!password || password.length < 12) return 'a senha precisa ter pelo menos 12 caracteres';
  if (WEAK_PASSWORDS.has(password.toLowerCase())) return 'a senha é conhecida/fraca demais';
  if (email && password.toLowerCase() === String(email).toLowerCase()) return 'a senha não pode ser igual ao e-mail';
  if (/^\d+$/.test(password)) return 'a senha não pode ser só números';
  return null;
}

module.exports = { validatePassword };
