import type { VelixManifest } from '../catalog.util';

export const mariadbManifest: VelixManifest = {
  slug: 'mariadb',
  name: 'MariaDB',
  description: 'Banco de dados relacional MariaDB, com senha root gerada automaticamente.',
  category: 'database',
  version: '11.4',
  icon: '/app-icons/mariadb.svg',
  author: 'Velix Official',
  documentationUrl: 'https://mariadb.com/kb/en/documentation/',
  minResources: { memoryMb: 512 },
  primaryService: 'db',
  primaryPort: 3306,
  // APP_PASSWORD é gerado mesmo quando o usuário não pede um usuário de app
  // (não dá pra gerar segredo condicionalmente) — sem uso nesse caso, mas
  // inofensivo: MARIADB_USER vazio faz a imagem oficial pular a criação do
  // usuário extra.
  secrets: [{ key: 'ROOT_PASSWORD' }, { key: 'APP_PASSWORD' }],
  services: [
    {
      name: 'db',
      image: 'mariadb:11.4',
      environment: {
        MARIADB_ROOT_PASSWORD: '{{secret:ROOT_PASSWORD}}',
        MARIADB_DATABASE: '{{var:DATABASE_NAME}}',
        MARIADB_USER: '{{var:APP_USER}}',
        MARIADB_PASSWORD: '{{secret:APP_PASSWORD}}',
      },
      variables: [
        { key: 'DATABASE_NAME', label: 'Nome do banco de dados', type: 'text', default: 'app', required: true },
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
