import 'reflect-metadata';
import helmet from 'helmet';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';
import { SshService } from './ssh/ssh.service';
import { attachTerminalServer } from './terminal/terminal-server';
import { attachOpsServer } from './ops/ops-server';
import { ServersService } from './servers/servers.service';
import { DatabaseService } from './database/database.service';
import { TraefikService } from './traefik/traefik.service';
import { ApplicationsService } from './applications/applications.service';
import { GitDeployService } from './applications/git-deploy.service';
import { DatabaseBackupService } from './database-backup/database-backup.service';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Sem isto, `req.ip` é o IP do container do frontend (::ffff:172.18.x.x) —
  // era o que aparecia em "Sessões ativas" e no que o rate limit de login
  // usava como chave. 1 salto = o server.js do web, que é quem entrega o
  // X-Forwarded-For já confiável (ver apps/web/server.js e client-ip.util.ts).
  app.set('trust proxy', 1);

  // Cabeçalhos de segurança: não havia nenhum. contentSecurityPolicy fica
  // desligado aqui porque quem serve HTML é o Next, no container do frontend —
  // uma CSP definida na API só valeria para respostas JSON, onde não faz efeito,
  // e daria falsa sensação de cobertura.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.enableCors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000' });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.setGlobalPrefix('api');
  const port = process.env.PORT ?? 3001;
  await app.listen(port);

  // Instalações via SSH (Docker, updates) podem levar minutos — o timeout
  // padrão do Node (requestTimeout/headersTimeout) derrubaria a conexão antes.
  const httpServer = app.getHttpServer();
  httpServer.requestTimeout = 0;
  httpServer.headersTimeout = 0;

  attachTerminalServer(httpServer, {
    jwt: app.get(JwtService),
    prisma: app.get(PrismaService),
    ssh: app.get(SshService),
  });

  attachOpsServer(httpServer, {
    jwt: app.get(JwtService),
    servers: app.get(ServersService),
    database: app.get(DatabaseService),
    traefik: app.get(TraefikService),
    applications: app.get(ApplicationsService),
    databaseBackup: app.get(DatabaseBackupService),
    gitDeploy: app.get(GitDeployService),
  });

  console.log(`Velix API rodando na porta ${port}`);
}

bootstrap();
