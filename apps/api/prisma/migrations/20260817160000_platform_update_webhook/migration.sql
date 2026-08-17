-- Autoatualização por push: qualquer push na branch configurada dispara o
-- mesmo self-update que o botão "Atualizar" já usa, sem esperar release.
CREATE TABLE "PlatformUpdateWebhook" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "secret" TEXT,
    "gitRef" TEXT NOT NULL DEFAULT 'main',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformUpdateWebhook_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformUpdateWebhook_secret_key" ON "PlatformUpdateWebhook"("secret");
