-- AlterTable
ALTER TABLE "Server" ADD COLUMN "isLocal" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "Server_isLocal_key" ON "Server"("isLocal") WHERE "isLocal" = true;
