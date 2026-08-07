/**
 * Prova que o grafo de injeção do Nest resolve inteiro:
 *   npx ts-node src/app.module.spec.ts
 *
 * O `tsc` passa mesmo quando um módulo esquece de importar o provedor de que
 * depende — a falha só aparece quando a API sobe e derruba o painel. Foi
 * exatamente assim que o UsersModule quebrou a v1.9.0: injetava AuditService
 * sem importar o AuditModule, e nada acusou até o deploy.
 *
 * Não precisa de banco: o PrismaService é substituído por um stub antes do Nest
 * instanciar qualquer coisa, então o que se verifica aqui é só a resolução de
 * dependências.
 */
import assert from 'node:assert';
import { PrismaService } from './prisma/prisma.service';

/** Absorve qualquer encadeamento (`prisma.user.findFirst()`) devolvendo null —
 * os hooks de onModuleInit consultam o banco e não podem quebrar a checagem. */
function nullProxy(): never {
  const target = () => Promise.resolve(null);
  return new Proxy(target, {
    get: (_t, prop) => (prop === 'then' ? undefined : nullProxy()),
    apply: () => Promise.resolve(null),
  }) as never;
}

// Trocado no protótipo antes de qualquer import do AppModule: o Nest instancia
// a classe real, mas todo método cai no stub.
for (const name of ['onModuleInit', 'onModuleDestroy', '$connect', '$disconnect'] as const) {
  Object.defineProperty(PrismaService.prototype, name, { value: async () => undefined, writable: true });
}
Object.setPrototypeOf(
  PrismaService.prototype,
  new Proxy({}, { get: (_t, prop) => (prop === 'then' ? undefined : nullProxy()) }),
);

async function main() {
  // Variáveis lidas em construtores — sem elas a falha seria de configuração,
  // não de injeção, que é o que está em teste.
  process.env.JWT_SECRET ??= 'segredo-de-teste-para-checagem-de-injecao';
  process.env.VELIX_CREDENTIAL_SECRET ??= 'a'.repeat(64);
  process.env.DATABASE_URL ??= 'postgresql://velix:velix@localhost:5432/velix';
  delete process.env.VELIX_LOCAL_SERVER; // não tentar ler a chave do host

  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('./app.module');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  assert.ok(app, 'contexto da aplicação não foi criado');
  await app.close();

  console.log('✓ app.module self-check OK — todos os módulos resolvem suas dependências');
}

main().catch((err) => {
  console.error('✗ Injeção falhou:', err instanceof Error ? err.message : err);
  process.exit(1);
});
