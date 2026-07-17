import type { VelixManifest } from '../catalog.util';

export const vaultwardenManifest: VelixManifest = {
  slug: 'vaultwarden',
  name: 'Vaultwarden',
  description: 'Servidor compatível com Bitwarden pra gerenciamento de senhas self-hosted.',
  category: 'security',
  version: '1.32.4',
  icon: '/app-icons/vaultwarden.svg',
  author: 'Velix Official',
  documentationUrl: 'https://github.com/dani-garcia/vaultwarden/wiki',
  minResources: { memoryMb: 256 },
  primaryService: 'app',
  primaryPort: 80,
  secrets: [{ key: 'ADMIN_TOKEN' }],
  services: [
    {
      name: 'app',
      image: 'vaultwarden/server:1.32.4',
      environment: {
        ADMIN_TOKEN: '{{secret:ADMIN_TOKEN}}',
        SIGNUPS_ALLOWED: '{{var:SIGNUPS_ALLOWED}}',
      },
      variables: [
        {
          key: 'SIGNUPS_ALLOWED',
          label: 'Permitir novos cadastros',
          type: 'boolean',
          options: ['true', 'false'],
          default: 'true',
          required: true,
        },
      ],
      volumes: [{ name: 'data', containerPath: '/data' }],
      ports: [{ port: 80, recommended: true }],
    },
  ],
};
