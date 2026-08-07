import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';

/**
 * Global como o PrismaModule.
 *
 * Auditoria é transversal: qualquer módulo que registre uma ação precisa dela.
 * Sem @Global, cada módulo novo tem que lembrar de importar o AuditModule — e
 * esquecer não dá erro de compilação, dá falha de injeção só quando a API sobe.
 * Foi exatamente assim que o UsersModule derrubou o painel na v1.9.0.
 */
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
