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
  /** Servidor onde o próprio Velix roda — registrado pelo instalador. */
  isLocal?: boolean;
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
  trending: boolean;
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
  applicationId: string;
  deploymentId: string;
  name: string;
  image: string;
  containerName: string;
  required: boolean;
  status: 'DEPLOYING' | 'RUNNING' | 'STOPPED' | 'ERROR';
  publishedPort: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectDeployment {
  id: string;
  applicationId: string;
  sourceType: string;
  manifestSlug: string | null;
  manifestVersion: string | null;
  selectedServices: string[];
  repoUrl: string | null;
  gitRef: string | null;
  buildMethod: string | null;
  dockerfilePath: string | null;
  gitAccountId: string | null;
  autoDeploy: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectDeploymentRun {
  id: string;
  deploymentId: string | null;
  trigger: string;
  status: 'RUNNING' | 'SUCCESS' | 'ERROR';
  commitSha: string | null;
  commitMessage: string | null;
  triggeredByUserId: string | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface ProjectDeploymentRunDetail extends ProjectDeploymentRun {
  applicationId: string;
  log: string | null;
}

export interface ProjectDomain {
  id: string;
  hostname: string;
  status: string;
  lastError: string | null;
  serviceName: string | null;
  targetPort: number;
}

export interface EndpointPort {
  port: number;
  protocol: string;
  recommended: boolean;
  source: 'template' | 'container';
}

export interface EndpointServiceInfo {
  serviceName: string;
  containerName: string;
  image: string;
  running: boolean;
  ports: EndpointPort[];
}

export interface ProjectDetail {
  id: string;
  serverId: string;
  server: { id: string; name: string; isLocal: boolean };
  name: string;
  slug: string;
  description: string | null;
  environment: 'PRODUCTION' | 'STAGING' | 'DEVELOPMENT' | 'LAB';
  tags: string[];
  status: 'EMPTY' | 'DEPLOYING' | 'RUNNING' | 'STOPPED' | 'ERROR' | 'REMOVING';
  lastError: string | null;
  deployedAt: string;
  domains: ProjectDomain[];
  deployments: ProjectDeployment[];
  services: ProjectService[];
}

export interface CatalogSecurityFinding {
  level: 'low' | 'medium' | 'high' | 'blocked';
  message: string;
}

export interface CatalogApplicationDetail extends CatalogApplicationSummary {
  documentationUrl?: string;
  repositoryUrl?: string;
  websiteUrl?: string;
  screenshots: string[];
  services: CatalogManifestService[];
  primaryService: string;
  primaryPort: number;
  secretKeys: string[];
  validation: { ok: boolean; errors: string[] };
  securityFindings: CatalogSecurityFinding[];
}

export interface DatabaseListItem {
  id: string;
  applicationId: string;
  name: string;
  image: string;
  containerName: string;
  status: 'DEPLOYING' | 'RUNNING' | 'STOPPED' | 'ERROR';
  publishedPort: number | null;
  createdAt: string;
  project: { id: string; name: string; slug: string };
  server: { id: string; name: string };
  hasSchedule: boolean;
}

export interface DatabaseBackupRoutine {
  id: string;
  name: string;
  image: string;
  project: { id: string; name: string; slug: string };
  server: { id: string; name: string };
  scheduledAt: string;
  retentionDays: number;
  destination: { id: string; label: string } | null;
  lastRun: { status: 'RUNNING' | 'SUCCESS' | 'ERROR'; startedAt: string; error: string | null } | null;
}

export interface BackupDestinationSummary {
  id: string;
  label: string;
  protocol: 'ftp' | 'sftp' | 's3';
  host: string | null;
  port: number | null;
  username: string;
  remotePath: string;
  bucket: string | null;
  region: string | null;
  createdAt: string;
}

export interface DatabaseBackupConfig {
  projectServiceId: string;
  scheduledAt: string | null;
  retentionDays: number;
  destinationId: string | null;
  database: string | null;
}

export interface DatabaseBackupRun {
  id: string;
  projectServiceId: string;
  trigger: 'scheduled' | 'manual';
  status: 'RUNNING' | 'SUCCESS' | 'ERROR';
  fileName: string | null;
  sizeBytes: number | null;
  uploadedRemote: boolean;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface DatabaseTableInfo {
  name: string;
  rowCount: number | null;
}

export interface DatabaseRowsResult {
  columns: string[];
  primaryKeys: string[];
  rows: Record<string, unknown>[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DatabaseQueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowsAffected: number | null;
  truncated: boolean;
}

export interface DatabaseQueryLogEntry {
  id: string;
  query: string;
  ok: boolean;
  rowCount: number | null;
  error: string | null;
  executedAt: string;
  userName: string;
}
