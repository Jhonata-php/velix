-- Horário e retenção do backup do próprio Velix, configuráveis pela tela
-- (antes: horário fixo no código, retenção só por env var).
CREATE TABLE "BackupSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "scheduledAt" TEXT NOT NULL DEFAULT '03:15',
    "retentionDays" INTEGER NOT NULL DEFAULT 14,

    CONSTRAINT "BackupSettings_pkey" PRIMARY KEY ("id")
);
