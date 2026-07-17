import type { VelixManifest } from '../catalog.util';

/** Sobe com a configuração padrão embutida na imagem (auto-monitoramento) — sem
 * suporte a scrape config customizado ainda (precisa de arquivo de config montado,
 * fora do escopo desta fase). */
export const prometheusManifest: VelixManifest = {
  slug: 'prometheus',
  name: 'Prometheus',
  description: 'Coleta e armazenamento de métricas com consulta via PromQL.',
  category: 'monitoring',
  version: '2.55.1',
  icon: '/app-icons/prometheus.svg',
  author: 'Velix Official',
  documentationUrl: 'https://prometheus.io/docs/introduction/overview/',
  minResources: { memoryMb: 512 },
  primaryService: 'app',
  primaryPort: 9090,
  services: [
    {
      name: 'app',
      image: 'prom/prometheus:v2.55.1',
      volumes: [{ name: 'data', containerPath: '/prometheus' }],
      ports: [{ port: 9090, recommended: true }],
    },
  ],
};
