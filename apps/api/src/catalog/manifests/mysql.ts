import type { VelixManifest } from '../catalog.util';

export const mysqlManifest: VelixManifest = {
  slug: 'mysql',
  name: 'MySQL',
  description: 'Banco de dados relacional MySQL, com senha root gerada automaticamente.',
  category: 'database',
  version: '8.4',
  icon: '/app-icons/mysql.svg',
  author: 'Velix Official',
  documentationUrl: 'https://dev.mysql.com/doc/refman/8.4/en/',
  minResources: { memoryMb: 512 },
  primaryService: 'db',
  primaryPort: 3306,
  // APP_PASSWORD é gerado mesmo quando o usuário não pede um usuário de app
  // (não dá pra gerar segredo condicionalmente) — sem uso nesse caso, mas
  // inofensivo: MYSQL_USER vazio faz a imagem oficial pular a criação do
  // usuário extra (checa "-n $MYSQL_USER" no entrypoint dela).
  secrets: [{ key: 'ROOT_PASSWORD' }, { key: 'APP_PASSWORD' }],
  services: [
    {
      name: 'db',
      image: 'mysql:8.4',
      environment: {
        MYSQL_ROOT_PASSWORD: '{{secret:ROOT_PASSWORD}}',
        MYSQL_DATABASE: '{{var:DATABASE_NAME}}',
        MYSQL_USER: '{{var:APP_USER}}',
        MYSQL_PASSWORD: '{{secret:APP_PASSWORD}}',
      },
      variables: [
        {
          key: 'DATABASE_NAME',
          label: 'Nome do banco de dados (opcional)',
          description: 'Deixe em branco pra não criar nenhum — crie e gerencie pelo painel, na aba Dados.',
          type: 'text',
        },
        {
          key: 'APP_USER',
          label: 'Usuário de aplicação (opcional)',
          description: 'Além do root — deixe em branco pra não criar nenhum.',
          type: 'text',
        },
      ],
      volumes: [{ name: 'data', containerPath: '/var/lib/mysql' }],
      ports: [{ port: 3306, recommended: true }],
    },
  ],
};
