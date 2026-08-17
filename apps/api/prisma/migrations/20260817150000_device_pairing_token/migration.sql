-- CreateTable
CREATE TABLE "DevicePairingToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DevicePairingToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DevicePairingToken_tokenHash_key" ON "DevicePairingToken"("tokenHash");

-- CreateIndex
CREATE INDEX "DevicePairingToken_userId_createdAt_idx" ON "DevicePairingToken"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "DevicePairingToken" ADD CONSTRAINT "DevicePairingToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
