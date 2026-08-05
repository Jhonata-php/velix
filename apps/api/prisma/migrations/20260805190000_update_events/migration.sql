-- CreateTable
CREATE TABLE "UpdateEvent" (
    "id" TEXT NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fromVersion" TEXT,
    "toVersion" TEXT NOT NULL,
    "appliedBy" TEXT NOT NULL DEFAULT 'desconhecido',

    CONSTRAINT "UpdateEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UpdateEvent_appliedAt_idx" ON "UpdateEvent"("appliedAt");
