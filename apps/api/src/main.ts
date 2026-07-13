import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

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

  console.log(`Velix API rodando na porta ${port}`);
}

bootstrap();
