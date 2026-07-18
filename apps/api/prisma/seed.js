// JS puro (não TypeScript) — roda direto em produção sem precisar compilar
// nem de ts-node/@types em runtime. Ver package.json ("prisma.seed") e
// docker-entrypoint.sh (chamado depois das migrations, nunca antes, e uma
// falha aqui nunca derruba o container — ver comentário lá).
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { validatePassword } = require('./password-policy');

const prisma = new PrismaClient();

/**
 * Idempotente por design: se o admin já existe, só confirma e sai — nunca
 * recria nem troca a senha de um usuário existente (isso é o que
 * `npm run admin:reset-password` faz, de forma explícita e auditável).
 */
async function main() {
  const email = process.env.VELIX_ADMIN_EMAIL;
  const password = process.env.VELIX_ADMIN_PASSWORD;

  if (!email || !password) {
    console.log('⚠ VELIX_ADMIN_EMAIL/VELIX_ADMIN_PASSWORD não definidos — nenhum administrador foi criado automaticamente.');
    return;
  }

  const normalizedEmail = email.trim().toLowerCase();

  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) {
    console.log(`✓ Admin user exists (${normalizedEmail})`);
    return;
  }

  const passwordError = validatePassword(password, normalizedEmail);
  if (passwordError) {
    console.error(`✗ Seed abortado: ${passwordError} — defina VELIX_ADMIN_PASSWORD com uma senha mais forte.`);
    process.exitCode = 1;
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.create({
    data: { name: 'Administrador', email: normalizedEmail, passwordHash, role: 'admin' },
  });
  console.log(`✓ Admin user created (${normalizedEmail})`);
}

main()
  .catch((err) => {
    // Mensagem curta por padrão — stack trace completo só com DEBUG=1, pra não
    // poluir o log de start com 40 linhas por um problema que é quase sempre
    // "banco ainda não migrado" ou uma variável de ambiente faltando.
    const message = err instanceof Error ? err.message : String(err);
    console.error(`✗ Seed failed: ${message}`);
    if (process.env.DEBUG) console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
