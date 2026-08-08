-- AlterTable
-- Tudo em ADD COLUMN simples, todas nullable (ou com DEFAULT) — sem ALTER
-- TYPE, sem backfill de dado real necessário: contas existentes já têm
-- tokenEnc/tokenHint preenchidos e caem no DEFAULT 'token' de authMethod
-- automaticamente. Ver o incidente da v1.11.0 (migração 20260808120000)
-- pra por que isso importa: enum novo usado na mesma transação que o criou
-- derruba a API inteira — aqui não há enum nenhum sendo criado.
ALTER TABLE "GitAccount" ADD COLUMN "authMethod" TEXT NOT NULL DEFAULT 'token';
ALTER TABLE "GitAccount" ADD COLUMN "githubAppId" TEXT;
ALTER TABLE "GitAccount" ADD COLUMN "githubAppSlug" TEXT;
ALTER TABLE "GitAccount" ADD COLUMN "installationId" TEXT;
ALTER TABLE "GitAccount" ADD COLUMN "credentialsEnc" TEXT;

ALTER TABLE "GitAccount" ALTER COLUMN "tokenEnc" DROP NOT NULL;
ALTER TABLE "GitAccount" ALTER COLUMN "tokenHint" DROP NOT NULL;
