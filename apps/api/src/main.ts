import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';
import { SshService } from './ssh/ssh.service';
import { attachTerminalServer } from './terminal/terminal-server';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
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

  console.log(`Velix API rodando na porta ${port}`);
}

bootstrap();
