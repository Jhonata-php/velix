import type { VelixManifest } from '../catalog.util';

/** Sem senha nesta fase — `requirepass` exige passar a senha por linha de comando
 * ou arquivo de config montado (suporte a config file ainda não existe no motor
 * de deploy), o que vazaria o segredo no compose salvo em texto puro. Só fica
 * acessível dentro da rede velix-proxy (não publica porta no host). */
export const redisManifest: VelixManifest = {
  slug: 'redis',
  name: 'Redis',
  description: 'Banco de dados em memória para cache, filas e pub/sub.',
  category: 'database',
  version: '7.4',
  icon: '/app-icons/redis.svg',
  author: 'Velix Official',
  documentationUrl: 'https://redis.io/docs/latest/',
  minResources: { memoryMb: 128 },
  primaryService: 'db',
  primaryPort: 6379,
  services: [
    {
      name: 'db',
      image: 'redis:7.4',
      volumes: [{ name: 'data', containerPath: '/data' }],
      ports: [{ port: 6379, recommended: true }],
    },
  ],
};
