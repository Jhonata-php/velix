-- Apelido de exibição do serviço (ex.: "n8n" em vez do nome interno "app")
-- para o usuário poder renomear o rótulo mostrado no painel sem mexer no
-- nome funcional (compose/container/rota), que continua em "name".
ALTER TABLE "ProjectService" ADD COLUMN "displayName" TEXT;
