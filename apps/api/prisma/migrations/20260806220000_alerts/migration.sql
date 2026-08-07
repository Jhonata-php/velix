-- CreateTable
CREATE TABLE "AlertChannel" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "configEnc" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertDelivery" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "error" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AlertDelivery_fingerprint_sentAt_idx" ON "AlertDelivery"("fingerprint", "sentAt");

-- CreateTable
CREATE TABLE "AlertState" (
    "fingerprint" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertState_pkey" PRIMARY KEY ("fingerprint")
);

-- AddForeignKey
ALTER TABLE "AlertDelivery" ADD CONSTRAINT "AlertDelivery_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "AlertChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
