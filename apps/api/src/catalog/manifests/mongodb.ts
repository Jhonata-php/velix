import type { VelixManifest } from '../catalog.util';

export const mongodbManifest: VelixManifest = {
  slug: 'mongodb',
  name: 'MongoDB',
  description: 'Banco de dados orientado a documentos, com usuário root gerado automaticamente.',
  category: 'database',
  version: '7.0',
  icon: '/app-icons/mongodb.svg',
  author: 'Velix Official',
  documentationUrl: 'https://www.mongodb.com/docs/',
  minResources: { memoryMb: 512 },
  primaryService: 'db',
  primaryPort: 27017,
  secrets: [{ key: 'ROOT_PASSWORD' }],
  services: [
    {
      name: 'db',
      image: 'mongo:7.0',
      environment: {
        MONGO_INITDB_ROOT_USERNAME: '{{var:ROOT_USERNAME}}',
        MONGO_INITDB_ROOT_PASSWORD: '{{secret:ROOT_PASSWORD}}',
      },
      variables: [{ key: 'ROOT_USERNAME', label: 'Usuário root', type: 'text', default: 'root', required: true }],
      volumes: [{ name: 'data', containerPath: '/data/db' }],
      ports: [{ port: 27017, recommended: true }],
    },
  ],
};
