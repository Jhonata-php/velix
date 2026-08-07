-- CreateTable
CREATE TABLE "GitAccount" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "host" TEXT NOT NULL DEFAULT 'github.com',
    "username" TEXT,
    "tokenEnc" TEXT NOT NULL,
    "tokenHint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GitAccount_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Application" ADD COLUMN "gitAccountId" TEXT;
ALTER TABLE "Application" ADD COLUMN "autoDeploy" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Application" ADD COLUMN "webhookSecret" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Application_webhookSecret_key" ON "Application"("webhookSecret");

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_gitAccountId_fkey" FOREIGN KEY ("gitAccountId") REFERENCES "GitAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
