import type { VelixManifest } from '../catalog.util';

export const grafanaManifest: VelixManifest = {
  slug: 'grafana',
  name: 'Grafana',
  description: 'Painéis e dashboards para visualização de métricas e logs.',
  category: 'monitoring',
  version: '11.4.0',
  icon: '/app-icons/grafana.svg',
  author: 'Velix Official',
  documentationUrl: 'https://grafana.com/docs/grafana/latest/',
  minResources: { memoryMb: 512 },
  primaryService: 'app',
  primaryPort: 3000,
  secrets: [{ key: 'ADMIN_PASSWORD' }],
  services: [
    {
      name: 'app',
      image: 'grafana/grafana-oss:11.4.0',
      environment: {
        GF_SECURITY_ADMIN_USER: '{{var:ADMIN_USER}}',
        GF_SECURITY_ADMIN_PASSWORD: '{{secret:ADMIN_PASSWORD}}',
      },
      variables: [{ key: 'ADMIN_USER', label: 'Usuário administrador', type: 'text', default: 'admin', required: true }],
      volumes: [{ name: 'data', containerPath: '/var/lib/grafana' }],
      ports: [{ port: 3000, recommended: true }],
    },
  ],
};
