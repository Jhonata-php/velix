-- AlterTable
ALTER TABLE "Application" ADD COLUMN "sourceType" TEXT NOT NULL DEFAULT 'catalog';
ALTER TABLE "Application" ADD COLUMN "repoUrl" TEXT;
ALTER TABLE "Application" ADD COLUMN "gitRef" TEXT;
ALTER TABLE "Application" ADD COLUMN "buildMethod" TEXT;
ALTER TABLE "Application" ADD COLUMN "dockerfilePath" TEXT;
ALTER TABLE "Application" ADD COLUMN "repoTokenEnc" TEXT;
