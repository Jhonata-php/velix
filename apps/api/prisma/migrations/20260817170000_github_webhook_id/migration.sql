-- Guarda o id do webhook criado automaticamente no GitHub, pra poder
-- removê-lo de lá quando o autodeploy é desligado.
ALTER TABLE "ProjectDeployment" ADD COLUMN "githubWebhookId" INTEGER;
