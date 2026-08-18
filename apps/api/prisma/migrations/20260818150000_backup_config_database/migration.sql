-- Backup de banco de dados sem essa coluna caía sempre no fallback fixo
-- "app" de resolvedDatabaseName() quando o manifesto/env não tinha o nome
-- real do banco — mysqldump então tentava um banco que não existe.
ALTER TABLE "DatabaseBackupConfig" ADD COLUMN "database" TEXT;
