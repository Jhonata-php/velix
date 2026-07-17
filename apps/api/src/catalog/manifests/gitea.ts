import type { VelixManifest } from '../catalog.util';

/** SQLite embutido — sem banco separado pra manter o primeiro deploy simples.
 * A conta de administrador é criada no assistente de instalação exibido na
 * primeira visita (mesmo padrão manual já usado hoje para o EasyPanel). */
export const giteaManifest: VelixManifest = {
  slug: 'gitea',
  name: 'Gitea',
  description: 'Serviço Git self-hosted leve, com issues, PRs e CI integrável.',
  category: 'development',
  version: '1.22.3',
  icon: '/app-icons/gitea.svg',
  author: 'Velix Official',
  documentationUrl: 'https://docs.gitea.com/',
  minResources: { memoryMb: 512 },
  primaryService: 'app',
  primaryPort: 3000,
  services: [
    {
      name: 'app',
      image: 'gitea/gitea:1.22.3',
      environment: {
        GITEA__database__DB_TYPE: 'sqlite3',
      },
      volumes: [{ name: 'data', containerPath: '/data' }],
      ports: [{ port: 3000, recommended: true }],
    },
  ],
};
