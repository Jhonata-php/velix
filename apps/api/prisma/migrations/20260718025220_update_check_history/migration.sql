-- CreateTable
CREATE TABLE "UpdateCheck" (
    "id" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "installedVersion" TEXT NOT NULL,
    "latestVersion" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'stable',
    "updateAvailable" BOOLEAN NOT NULL DEFAULT false,
    "releaseUrl" TEXT,
    "publishedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "UpdateCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UpdateCheck_checkedAt_idx" ON "UpdateCheck"("checkedAt");
