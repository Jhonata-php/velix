import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.VELIX_ADMIN_EMAIL ?? 'admin@velix.local';
  const password = process.env.VELIX_ADMIN_PASSWORD ?? 'changeme123';

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Usuário admin já existe: ${email}`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.create({
    data: { name: 'Administrador', email, passwordHash, role: 'admin' },
  });
  console.log(`Usuário admin criado: ${email}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
