-- CreateTable
CREATE TABLE "ServiceMetricSample" (
    "id" TEXT NOT NULL,
    "projectServiceId" TEXT NOT NULL,
    "cpuPercent" DOUBLE PRECISION,
    "memUsedMb" DOUBLE PRECISION,
    "memTotalMb" DOUBLE PRECISION,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceMetricSample_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServiceMetricSample_projectServiceId_capturedAt_idx" ON "ServiceMetricSample"("projectServiceId", "capturedAt");

-- AddForeignKey
ALTER TABLE "ServiceMetricSample" ADD CONSTRAINT "ServiceMetricSample_projectServiceId_fkey" FOREIGN KEY ("projectServiceId") REFERENCES "ProjectService"("id") ON DELETE CASCADE ON UPDATE CASCADE;
