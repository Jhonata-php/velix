import type { VelixManifest } from '../catalog.util';

export const minioManifest: VelixManifest = {
  slug: 'minio',
  name: 'MinIO',
  description: 'Armazenamento de objetos compatível com S3, com console web.',
  category: 'storage',
  version: 'RELEASE.2024-11-07',
  icon: '/app-icons/minio.svg',
  author: 'Velix Official',
  documentationUrl: 'https://min.io/docs/minio/container/index.html',
  minResources: { memoryMb: 512 },
  primaryService: 'app',
  primaryPort: 9001,
  secrets: [{ key: 'ROOT_PASSWORD' }],
  services: [
    {
      name: 'app',
      image: 'minio/minio:RELEASE.2024-11-07T00-52-20Z',
      command: 'server /data --console-address ":9001"',
      environment: {
        MINIO_ROOT_USER: 'admin',
        MINIO_ROOT_PASSWORD: '{{secret:ROOT_PASSWORD}}',
      },
      volumes: [{ name: 'data', containerPath: '/data' }],
      ports: [
        { port: 9001, recommended: true },
        { port: 9000 },
      ],
    },
  ],
};
