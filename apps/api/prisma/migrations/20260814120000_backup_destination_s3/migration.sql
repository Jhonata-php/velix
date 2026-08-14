-- Suporte a S3 (e compatíveis) como destino de backup, junto com FTP/SFTP.
-- host/port deixam de ser obrigatórios (S3 não precisa dos dois: endpoint
-- customizado é opcional, porta não existe pra esse protocolo).
ALTER TABLE "BackupDestination" ALTER COLUMN "host" DROP NOT NULL;
ALTER TABLE "BackupDestination" ALTER COLUMN "port" DROP NOT NULL;
ALTER TABLE "BackupDestination" ADD COLUMN "bucket" TEXT;
ALTER TABLE "BackupDestination" ADD COLUMN "region" TEXT;
