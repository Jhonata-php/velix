-- CreateEnum
CREATE TYPE "ServerStatus" AS ENUM ('PENDING', 'ONLINE', 'OFFLINE', 'ERROR');

-- CreateEnum
CREATE TYPE "AuthMethod" AS ENUM ('PASSWORD', 'PRIVATE_KEY');

-- CreateEnum
CREATE TYPE "DomainStatus" AS ENUM ('PENDING', 'ACTIVE', 'ERROR');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('DEPLOYING', 'RUNNING', 'STOPPED', 'ERROR', 'REMOVING');

-- CreateEnum
CREATE TYPE "ApplicationEnvironment" AS ENUM ('PRODUCTION', 'STAGING', 'DEVELOPMENT', 'LAB');

-- CreateEnum
CREATE TYPE "ProjectServiceStatus" AS ENUM ('DEPLOYING', 'RUNNING', 'STOPPED', 'ERROR');

-- CreateEnum
CREATE TYPE "DbEngine" AS ENUM ('MYSQL');

-- CreateEnum
CREATE TYPE "DbRole" AS ENUM ('STANDALONE', 'PRIMARY', 'REPLICA');

-- CreateEnum
CREATE TYPE "DbInstanceStatus" AS ENUM ('PENDING', 'ONLINE', 'OFFLINE', 'ERROR');

-- CreateEnum
CREATE TYPE "ReplicationStatus" AS ENUM ('PROVISIONING', 'SYNCING', 'IN_SYNC', 'DELAYED', 'ERROR', 'PROMOTED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'admin',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CloudflareAccount" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "apiTokenEnc" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CloudflareAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Server" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "publicIp" TEXT,
    "privateIp" TEXT,
    "hostname" TEXT,
    "sshPort" INTEGER NOT NULL DEFAULT 22,
    "sshUser" TEXT NOT NULL,
    "authMethod" "AuthMethod" NOT NULL DEFAULT 'PASSWORD',
    "credentialEnc" TEXT NOT NULL,
    "status" "ServerStatus" NOT NULL DEFAULT 'PENDING',
    "osName" TEXT,
    "osVersion" TEXT,
    "packageManager" TEXT,
    "dockerInstalled" BOOLEAN NOT NULL DEFAULT false,
    "dockerVersion" TEXT,
    "easypanelInstalled" BOOLEAN NOT NULL DEFAULT false,
    "easypanelUrl" TEXT,
    "traefikInstalled" BOOLEAN NOT NULL DEFAULT false,
    "traefikVersion" TEXT,
    "platformState" TEXT NOT NULL DEFAULT 'NOT_PREPARED',
    "metrics" JSONB,
    "metricsCheckedAt" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3),
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "environment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Server_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Domain" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "applicationId" TEXT,
    "hostname" TEXT NOT NULL,
    "serviceName" TEXT,
    "targetPort" INTEGER NOT NULL,
    "createDnsRecord" BOOLEAN NOT NULL DEFAULT true,
    "cloudflareRecordId" TEXT,
    "cloudflareZoneId" TEXT,
    "status" "DomainStatus" NOT NULL DEFAULT 'PENDING',
    "lastError" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Domain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "environment" "ApplicationEnvironment" NOT NULL DEFAULT 'PRODUCTION',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "manifestSlug" TEXT NOT NULL,
    "manifestVersion" TEXT NOT NULL,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'DEPLOYING',
    "composeRendered" TEXT NOT NULL,
    "containerNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "selectedServices" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "secretsEnc" TEXT,
    "variablesJson" TEXT,
    "lastError" TEXT,
    "deployedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectService" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "image" TEXT NOT NULL,
    "containerName" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "status" "ProjectServiceStatus" NOT NULL DEFAULT 'DEPLOYING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServerMirror" (
    "id" TEXT NOT NULL,
    "sourceServerId" TEXT NOT NULL,
    "targetServerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServerMirror_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServerMetricSample" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "loadAvg1" DOUBLE PRECISION,
    "memUsedMb" INTEGER,
    "memTotalMb" INTEGER,
    "diskPercent" DOUBLE PRECISION,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServerMetricSample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DatabaseInstance" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "engine" "DbEngine" NOT NULL DEFAULT 'MYSQL',
    "containerName" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "mysqlServerId" INTEGER NOT NULL,
    "role" "DbRole" NOT NULL DEFAULT 'STANDALONE',
    "status" "DbInstanceStatus" NOT NULL DEFAULT 'PENDING',
    "version" TEXT,
    "databaseName" TEXT NOT NULL,
    "appUser" TEXT NOT NULL,
    "appPasswordEnc" TEXT NOT NULL,
    "rootPasswordEnc" TEXT NOT NULL,
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DatabaseInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DatabaseReplication" (
    "id" TEXT NOT NULL,
    "primaryInstanceId" TEXT NOT NULL,
    "replicaInstanceId" TEXT NOT NULL,
    "replicationUser" TEXT NOT NULL,
    "replicationPasswordEnc" TEXT NOT NULL,
    "status" "ReplicationStatus" NOT NULL DEFAULT 'PROVISIONING',
    "secondsBehind" INTEGER,
    "lastError" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DatabaseReplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Domain_hostname_key" ON "Domain"("hostname");

-- CreateIndex
CREATE INDEX "Domain_serverId_idx" ON "Domain"("serverId");

-- CreateIndex
CREATE UNIQUE INDEX "Application_slug_key" ON "Application"("slug");

-- CreateIndex
CREATE INDEX "Application_serverId_idx" ON "Application"("serverId");

-- CreateIndex
CREATE INDEX "ProjectService_applicationId_idx" ON "ProjectService"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectService_applicationId_name_key" ON "ProjectService"("applicationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ServerMirror_sourceServerId_key" ON "ServerMirror"("sourceServerId");

-- CreateIndex
CREATE INDEX "ServerMetricSample_serverId_capturedAt_idx" ON "ServerMetricSample"("serverId", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DatabaseReplication_replicaInstanceId_key" ON "DatabaseReplication"("replicaInstanceId");

-- AddForeignKey
ALTER TABLE "Domain" ADD CONSTRAINT "Domain_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Domain" ADD CONSTRAINT "Domain_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectService" ADD CONSTRAINT "ProjectService_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServerMirror" ADD CONSTRAINT "ServerMirror_sourceServerId_fkey" FOREIGN KEY ("sourceServerId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServerMirror" ADD CONSTRAINT "ServerMirror_targetServerId_fkey" FOREIGN KEY ("targetServerId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServerMetricSample" ADD CONSTRAINT "ServerMetricSample_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatabaseInstance" ADD CONSTRAINT "DatabaseInstance_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatabaseReplication" ADD CONSTRAINT "DatabaseReplication_primaryInstanceId_fkey" FOREIGN KEY ("primaryInstanceId") REFERENCES "DatabaseInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatabaseReplication" ADD CONSTRAINT "DatabaseReplication_replicaInstanceId_fkey" FOREIGN KEY ("replicaInstanceId") REFERENCES "DatabaseInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

