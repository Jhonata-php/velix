import type { VelixManifest } from '../catalog.util';

export const n8nManifest: VelixManifest = {
  slug: 'n8n',
  name: 'n8n',
  description: 'Automação de workflows com editor visual, low-code e centenas de integrações.',
  category: 'automation',
  version: '1.71.3',
  icon: '/app-icons/n8n.svg',
  author: 'Velix Official',
  documentationUrl: 'https://docs.n8n.io/',
  minResources: { memoryMb: 512 },
  primaryService: 'app',
  primaryPort: 5678,
  secrets: [{ key: 'BASIC_AUTH_PASSWORD' }],
  services: [
    {
      name: 'app',
      image: 'n8nio/n8n:1.71.3',
      environment: {
        N8N_BASIC_AUTH_ACTIVE: 'true',
        N8N_BASIC_AUTH_USER: '{{var:BASIC_AUTH_USER}}',
        N8N_BASIC_AUTH_PASSWORD: '{{secret:BASIC_AUTH_PASSWORD}}',
        GENERIC_TIMEZONE: '{{var:TIMEZONE}}',
      },
      variables: [
        { key: 'BASIC_AUTH_USER', label: 'Usuário administrador', type: 'text', default: 'admin', required: true },
        { key: 'TIMEZONE', label: 'Fuso horário', type: 'text', default: 'America/Sao_Paulo', required: true },
      ],
      volumes: [{ name: 'data', containerPath: '/home/node/.n8n' }],
      ports: [{ port: 5678, recommended: true }],
    },
  ],
};
