#!/usr/bin/env node
// Redefinição administrativa de senha — nunca acontece automaticamente no
// seed/startup (ver prisma/seed.js), só quando o operador roda isso
// explicitamente, com o e-mail do usuário como confirmação de intenção.
//
//   npm run admin:reset-password -- --email suporte@needbr.com
//   npm run admin:reset-password -- --email suporte@needbr.com --password "..."
//
// Sem --password, pede a senha nova interativamente (sem ecoar no terminal).
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { validatePassword } = require('../prisma/password-policy');

const prisma = new PrismaClient();

// String.fromCharCode em vez de escapes literais no fonte — mais seguro que
// depender de caracteres de controle invisíveis sobrevivendo intactos a
// qualquer edição/cópia futura do arquivo.
const KEY_ENTER = '\r';
const KEY_NEWLINE = '\n';
const KEY_CTRL_D = String.fromCharCode(4);
const KEY_CTRL_C = String.fromCharCode(3);
const KEY_BACKSPACE = String.fromCharCode(127);

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--email') args.email = argv[++i];
    else if (argv[i] === '--password') args.password = argv[++i];
  }
  return args;
}

/** Prompt de senha sem eco no terminal — sem dependência externa. */
function promptHidden(question) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      reject(new Error('Terminal interativo necessário — use --password ou rode com `docker compose exec -it`.'));
      return;
    }
    process.stdout.write(question);
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (chunk) => {
      const char = chunk.toString('utf8');
      if (char === KEY_NEWLINE || char === KEY_ENTER || char === KEY_CTRL_D) {
        stdin.removeListener('data', onData);
        stdin.setRawMode(false);
        stdin.pause();
        process.stdout.write('\n');
        resolve(value);
        return;
      }
      if (char === KEY_CTRL_C) {
        process.stdout.write('\n');
        process.exit(1);
      }
      if (char === KEY_BACKSPACE) {
        value = value.slice(0, -1);
        return;
      }
      value += char;
    };
    stdin.on('data', onData);
  });
}

async function main() {
  const { email, password: passwordArg } = parseArgs(process.argv.slice(2));
  if (!email) {
    console.error('✗ Uso: npm run admin:reset-password -- --email usuario@dominio.com [--password "..."]');
    process.exitCode = 1;
    return;
  }
  const normalizedEmail = email.trim().toLowerCase();

  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (!user) {
    console.error(`✗ Nenhum usuário encontrado com o e-mail ${normalizedEmail}`);
    process.exitCode = 1;
    return;
  }

  const password = passwordArg || (await promptHidden('Nova senha: '));
  const passwordError = validatePassword(password, normalizedEmail);
  if (passwordError) {
    console.error(`✗ Senha rejeitada: ${passwordError}`);
    process.exitCode = 1;
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
  console.log(`✓ Senha redefinida para ${normalizedEmail}`);
}

main()
  .catch((err) => {
    console.error(`✗ Falha ao redefinir senha: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
