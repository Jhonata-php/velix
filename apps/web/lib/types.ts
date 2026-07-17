export interface DatabaseInstanceSummary {
  id: string;
  name: string;
  engine: string;
  containerName: string;
  port: number;
  role: 'STANDALONE' | 'PRIMARY' | 'REPLICA';
  status: string;
  databaseName: string;
  version: string | null;
}

export interface ServerMetrics {
  uptimeText: string | null;
  loadAvg: [number, number, number] | null;
  memTotalMb: number | null;
  memUsedMb: number | null;
  diskTotal?: string | null;
  diskUsed?: string | null;
  diskPercent: string | null;
}

export interface ServerSummary {
  id: string;
  name: string;
  publicIp: string | null;
  privateIp: string | null;
  sshPort: number;
  sshUser: string;
  authMethod: 'PASSWORD' | 'PRIVATE_KEY';
  status: 'PENDING' | 'ONLINE' | 'OFFLINE' | 'ERROR';
  osName: string | null;
  dockerInstalled: boolean;
  traefikInstalled: boolean;
  platformState: string;
  metrics: ServerMetrics | null;
}

export interface CatalogInstallInfo {
  serverId: string;
  serverName: string;
  applicationId: string;
  status: string;
  hostname: string | null;
}

export interface CatalogApplicationSummary {
  slug: string;
  name: string;
  description: string;
  category: string;
  version: string;
  icon: string;
  author: string;
  source: string;
  trust: string;
  riskLevel: 'low' | 'medium' | 'high' | 'blocked';
  servicesCount: number;
  minResources: { memoryMb: number };
  installed: CatalogInstallInfo[];
}

export interface CatalogManifestVariable {
  key: string;
  label: string;
  description?: string;
  type: 'text' | 'password' | 'number' | 'boolean' | 'select';
  options?: string[];
  default?: string;
  required?: boolean;
}

export interface CatalogManifestPort {
  port: number;
  protocol?: 'tcp' | 'udp';
  recommended?: boolean;
}

export interface CatalogManifestVolume {
  name: string;
  containerPath: string;
}

export interface CatalogManifestService {
  name: string;
  image: string;
  volumes: CatalogManifestVolume[];
  ports: CatalogManifestPort[];
  variables: CatalogManifestVariable[];
  optional: boolean;
  dependsOn: string[];
}

export interface ProjectService {
  id: string;
  name: string;
  image: string;
  containerName: string;
  required: boolean;
  status: 'DEPLOYING' | 'RUNNING' | 'STOPPED' | 'ERROR';
  createdAt: string;
  updatedAt: string;
}

export interface CatalogSecurityFinding {
  level: 'low' | 'medium' | 'high' | 'blocked';
  message: string;
}

export interface CatalogApplicationDetail extends CatalogApplicationSummary {
  documentationUrl?: string;
  services: CatalogManifestService[];
  primaryService: string;
  primaryPort: number;
  secretKeys: string[];
  validation: { ok: boolean; errors: string[] };
  securityFindings: CatalogSecurityFinding[];
}
