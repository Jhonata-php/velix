-- CreateTable
CREATE TABLE "ProjectDeployment" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'catalog',
    "manifestSlug" TEXT,
    "manifestVersion" TEXT,
    "selectedServices" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "secretsEnc" TEXT,
    "variablesJson" TEXT,
    "repoUrl" TEXT,
    "gitRef" TEXT,
    "buildMethod" TEXT,
    "dockerfilePath" TEXT,
    "repoTokenEnc" TEXT,
    "gitAccountId" TEXT,
    "autoDeploy" BOOLEAN NOT NULL DEFAULT false,
    "webhookSecret" TEXT,
    "composeRendered" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectDeployment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectDeployment_webhookSecret_key" ON "ProjectDeployment"("webhookSecret");
CREATE INDEX "ProjectDeployment_applicationId_idx" ON "ProjectDeployment"("applicationId");

-- AddForeignKey
ALTER TABLE "ProjectDeployment" ADD CONSTRAINT "ProjectDeployment_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectDeployment" ADD CONSTRAINT "ProjectDeployment_gitAccountId_fkey" FOREIGN KEY ("gitAccountId") REFERENCES "GitAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: uma ProjectDeployment por Application já existente, copiando os
-- campos que saem dela nesta migração — necessário porque `ProjectService.
-- deploymentId` vira NOT NULL mais abaixo, e instalações reais já têm
-- aplicações implantadas antes desta versão existir.
INSERT INTO "ProjectDeployment" (
    "id", "applicationId", "sourceType", "manifestSlug", "manifestVersion",
    "selectedServices", "secretsEnc", "variablesJson",
    "repoUrl", "gitRef", "buildMethod", "dockerfilePath", "repoTokenEnc",
    "gitAccountId", "autoDeploy", "webhookSecret", "composeRendered", "createdAt", "updatedAt"
)
SELECT
    gen_random_uuid(), "id", "sourceType", "manifestSlug", "manifestVersion",
    "selectedServices", "secretsEnc", "variablesJson",
    "repoUrl", "gitRef", "buildMethod", "dockerfilePath", "repoTokenEnc",
    "gitAccountId", "autoDeploy", "webhookSecret", "composeRendered", "deployedAt", "updatedAt"
FROM "Application";

-- AlterTable: ProjectService passa a apontar pra deployment de origem
ALTER TABLE "ProjectService" ADD COLUMN "deploymentId" TEXT;

UPDATE "ProjectService" ps
SET "deploymentId" = pd."id"
FROM "ProjectDeployment" pd
WHERE pd."applicationId" = ps."applicationId";

ALTER TABLE "ProjectService" ALTER COLUMN "deploymentId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "ProjectService_deploymentId_idx" ON "ProjectService"("deploymentId");

-- AddForeignKey
ALTER TABLE "ProjectService" ADD CONSTRAINT "ProjectService_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "ProjectDeployment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: Application perde os campos que migraram pra ProjectDeployment
-- (o projeto deixa de estar amarrado a UM manifesto/repo só)
ALTER TABLE "Application" DROP CONSTRAINT IF EXISTS "Application_gitAccountId_fkey";
DROP INDEX IF EXISTS "Application_webhookSecret_key";
ALTER TABLE "Application" DROP COLUMN "sourceType";
ALTER TABLE "Application" DROP COLUMN "repoUrl";
ALTER TABLE "Application" DROP COLUMN "gitRef";
ALTER TABLE "Application" DROP COLUMN "buildMethod";
ALTER TABLE "Application" DROP COLUMN "dockerfilePath";
ALTER TABLE "Application" DROP COLUMN "repoTokenEnc";
ALTER TABLE "Application" DROP COLUMN "gitAccountId";
ALTER TABLE "Application" DROP COLUMN "autoDeploy";
ALTER TABLE "Application" DROP COLUMN "webhookSecret";
ALTER TABLE "Application" DROP COLUMN "manifestSlug";
ALTER TABLE "Application" DROP COLUMN "manifestVersion";
ALTER TABLE "Application" DROP COLUMN "selectedServices";
ALTER TABLE "Application" DROP COLUMN "secretsEnc";
ALTER TABLE "Application" DROP COLUMN "variablesJson";

ALTER TABLE "Application" ALTER COLUMN "composeRendered" SET DEFAULT '';
ALTER TABLE "Application" ALTER COLUMN "status" SET DEFAULT 'EMPTY';
