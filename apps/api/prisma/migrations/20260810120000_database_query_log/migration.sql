-- CreateTable
CREATE TABLE "DatabaseQueryLog" (
    "id" TEXT NOT NULL,
    "projectServiceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "rowCount" INTEGER,
    "error" TEXT,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DatabaseQueryLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DatabaseQueryLog_projectServiceId_executedAt_idx" ON "DatabaseQueryLog"("projectServiceId", "executedAt");

-- AddForeignKey
ALTER TABLE "DatabaseQueryLog" ADD CONSTRAINT "DatabaseQueryLog_projectServiceId_fkey" FOREIGN KEY ("projectServiceId") REFERENCES "ProjectService"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatabaseQueryLog" ADD CONSTRAINT "DatabaseQueryLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
