-- CreateTable
CREATE TABLE "ProjectDeploymentRun" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "deploymentId" TEXT,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "commitSha" TEXT,
    "commitMessage" TEXT,
    "triggeredByUserId" TEXT,
    "error" TEXT,
    "log" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ProjectDeploymentRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectDeploymentRun_applicationId_startedAt_idx" ON "ProjectDeploymentRun"("applicationId", "startedAt");

-- AddForeignKey
ALTER TABLE "ProjectDeploymentRun" ADD CONSTRAINT "ProjectDeploymentRun_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;
