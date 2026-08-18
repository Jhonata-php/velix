import type { VelixManifest } from '../catalog.util';

/** A imagem "appliance" (tudo num container só) foi descontinuada pelo
 * próprio Zabbix — o jeito oficial hoje é server + web + banco separados
 * (ver zabbix/zabbix-docker). PHP_TZ fixo em vez de variável: mesmo padrão
 * de TZ fixo já usado no manifesto do Pi-hole. */
export const zabbixManifest: VelixManifest = {
  slug: 'zabbix',
  name: 'Zabbix',
  description: 'Monitoramento de infraestrutura e rede, com alertas e dashboards.',
  category: 'monitoring',
  version: '7.4',
  icon: 'https://cdn.jsdelivr.net/gh/selfhst/icons/svg/zabbix.svg',
  author: 'Velix Official',
  documentationUrl: 'https://www.zabbix.com/documentation/current/en/manual',
  minResources: { memoryMb: 1024 },
  primaryService: 'web',
  primaryPort: 8080,
  secrets: [{ key: 'DB_PASSWORD' }],
  services: [
    {
      name: 'db',
      image: 'postgres:16.4',
      environment: {
        POSTGRES_USER: 'zabbix',
        POSTGRES_PASSWORD: '{{secret:DB_PASSWORD}}',
        POSTGRES_DB: 'zabbix',
      },
      volumes: [{ name: 'db-data', containerPath: '/var/lib/postgresql/data' }],
    },
    {
      name: 'server',
      image: 'zabbix/zabbix-server-pgsql:alpine-7.4.13',
      environment: {
        DB_SERVER_HOST: '{{service:db}}',
        POSTGRES_USER: 'zabbix',
        POSTGRES_PASSWORD: '{{secret:DB_PASSWORD}}',
        POSTGRES_DB: 'zabbix',
      },
      volumes: [{ name: 'server-data', containerPath: '/var/lib/zabbix' }],
      // 10051/tcp = trapper — só precisa ficar acessível de fora se algum
      // agente Zabbix externo (fora da rede do Velix) reportar pra este servidor.
      ports: [{ port: 10051, recommended: false }],
      dependsOn: ['db'],
    },
    {
      name: 'web',
      image: 'zabbix/zabbix-web-nginx-pgsql:alpine-7.4.13',
      environment: {
        DB_SERVER_HOST: '{{service:db}}',
        POSTGRES_USER: 'zabbix',
        POSTGRES_PASSWORD: '{{secret:DB_PASSWORD}}',
        POSTGRES_DB: 'zabbix',
        ZBX_SERVER_HOST: '{{service:server}}',
        PHP_TZ: 'America/Sao_Paulo',
      },
      ports: [{ port: 8080, recommended: true }],
      dependsOn: ['db', 'server'],
    },
  ],
};
