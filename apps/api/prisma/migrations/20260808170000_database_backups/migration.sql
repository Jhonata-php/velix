-- CreateTable
CREATE TABLE "BackupDestination" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "protocol" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "username" TEXT NOT NULL,
    "credentialEnc" TEXT NOT NULL,
    "remotePath" TEXT NOT NULL DEFAULT '/',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackupDestination_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DatabaseBackupConfig" (
    "id" TEXT NOT NULL,
    "projectServiceId" TEXT NOT NULL,
    "scheduledAt" TEXT,
    "retentionDays" INTEGER NOT NULL DEFAULT 14,
    "destinationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DatabaseBackupConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DatabaseBackupRun" (
    "id" TEXT NOT NULL,
    "projectServiceId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "fileName" TEXT,
    "sizeBytes" INTEGER,
    "uploadedRemote" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "DatabaseBackupRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DatabaseBackupConfig_projectServiceId_key" ON "DatabaseBackupConfig"("projectServiceId");

-- CreateIndex
CREATE INDEX "DatabaseBackupRun_projectServiceId_idx" ON "DatabaseBackupRun"("projectServiceId");

-- AddForeignKey
ALTER TABLE "DatabaseBackupConfig" ADD CONSTRAINT "DatabaseBackupConfig_projectServiceId_fkey" FOREIGN KEY ("projectServiceId") REFERENCES "ProjectService"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatabaseBackupConfig" ADD CONSTRAINT "DatabaseBackupConfig_destinationId_fkey" FOREIGN KEY ("destinationId") REFERENCES "BackupDestination"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatabaseBackupRun" ADD CONSTRAINT "DatabaseBackupRun_projectServiceId_fkey" FOREIGN KEY ("projectServiceId") REFERENCES "ProjectService"("id") ON DELETE CASCADE ON UPDATE CASCADE;
