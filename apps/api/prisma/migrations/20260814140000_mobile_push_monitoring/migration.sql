-- Push notification (token de dispositivo) e limites de alerta configuráveis
-- por pessoa (CPU/memória/temperatura/eventos de container), pro
-- monitoramento em tempo real usado pelos apps móveis. Ver
-- docs/superpowers/specs/2026-08-14-mobile-push-monitoring-backend-design.md.

CREATE TABLE "DeviceToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "fcmToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DeviceToken_fcmToken_key" ON "DeviceToken"("fcmToken");
CREATE INDEX "DeviceToken_userId_idx" ON "DeviceToken"("userId");

ALTER TABLE "DeviceToken" ADD CONSTRAINT "DeviceToken_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AlertThresholdPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "serverId" TEXT,
    "cpuPercent" INTEGER,
    "memoryPercent" INTEGER,
    "temperatureCelsius" INTEGER,
    "dockerScope" TEXT NOT NULL DEFAULT 'all',
    "dockerEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertThresholdPreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AlertThresholdPreference_userId_serverId_key" ON "AlertThresholdPreference"("userId", "serverId");

ALTER TABLE "AlertThresholdPreference" ADD CONSTRAINT "AlertThresholdPreference_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AlertThresholdPreference" ADD CONSTRAINT "AlertThresholdPreference_serverId_fkey"
    FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ServerMetricSample" ADD COLUMN "cpuPercent" DOUBLE PRECISION;
ALTER TABLE "ServerMetricSample" ADD COLUMN "temperatureCelsius" DOUBLE PRECISION;
