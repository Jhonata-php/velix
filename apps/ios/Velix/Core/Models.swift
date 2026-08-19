import Foundation

struct LoginResponse: Decodable {
    let accessToken: String?
    let user: LoggedUser?
    let reason: String?
}

struct LoggedUser: Decodable {
    let name: String
    let email: String
    let role: String
}

// Snapshot bruto guardado em `Server.metrics` (coluna Json) — formato de
// `parseMetrics` em apps/api/src/servers/metrics.util.ts, diferente do
// histórico agregado em `ServerMetricSample` (ver `MetricSample` abaixo):
// `diskPercent` vem como string ("42%"), não número, e o load average é
// uma lista de 3 posições, não um campo `loadAvg1` solto.
struct ServerMetrics: Decodable {
    let loadAvg: [Double]?
    let memUsedMb: Int?
    let memTotalMb: Int?
    let diskPercent: String?
    let cpuPercent: Double?
    let temperatureCelsius: Double?
}

struct ServerSummary: Decodable, Identifiable {
    let id: String
    let name: String
    let status: String
    let publicIp: String?
    let hostname: String?
    let dockerInstalled: Bool
    let metrics: ServerMetrics?
}

/// Resposta de POST /servers/:id/reboot — `message` explica o resultado
/// (ex.: "Comando enviado" ou o motivo de uma falha), sem outros campos.
struct ServerActionResponse: Decodable {
    let ok: Bool
    let message: String
}

// GET /servers/:id/docker/status (servers.service.ts:dockerStatus) — sem
// version quando `installed` é false, sem containers também nesse caso.
struct DockerStatusResponse: Decodable {
    let installed: Bool
    let version: String?
    let containers: [DockerContainerInfo]?
}

// `status` é a saída bruta de `docker ps` (ex.: "Up 3 hours", "Exited (0) 2
// days ago") — não um enum fechado, mesmo formato que o painel web usa
// (`status.toLowerCase().includes("up")` pra decidir se está rodando).
struct DockerContainerInfo: Decodable, Identifiable {
    let id: String
    let image: String
    let status: String
    let names: String

    var isRunning: Bool { status.lowercased().contains("up") }
}

struct MetricSample: Decodable, Identifiable {
    var id: String { capturedAt }
    let loadAvg1: Double?
    let memUsedMb: Int?
    let memTotalMb: Int?
    let diskPercent: Double?
    let cpuPercent: Double?
    let temperatureCelsius: Double?
    let capturedAt: String
}

// GET /servers/:id/applications (applications.service.ts:63) — projetos
// implantados nesse servidor. `domains` e `deployments` do backend carregam
// bem mais campo do que precisamos aqui; JSONDecoder ignora o resto sozinho.
struct ProjectDomain: Decodable {
    let hostname: String
}

// `id` só vem preenchido em GET /applications/:id (detalhe) — a listagem por
// servidor seleciona só sourceType/manifestSlug. Opcional pra decodificar os
// dois formatos sem duplicar o struct.
struct ProjectDeploymentSummary: Decodable {
    let id: String?
    let sourceType: String
}

struct ProjectSummary: Decodable, Identifiable {
    let id: String
    let name: String
    let status: String
    let tags: [String]
    let domains: [ProjectDomain]
    let deployments: [ProjectDeploymentSummary]
}

// GET /servers/:id/domains (traefik.controller.ts) — vem direto do Prisma
// (model Domain), sem seleção de campos, então `status` é sempre um dos 3
// valores do enum DomainStatus. `lastCheckedAt`/`createdAt` chegam como
// string ISO — mesmo motivo de `MetricSample.capturedAt`.
struct ServerDomain: Decodable, Identifiable {
    let id: String
    let hostname: String
    let targetPort: Int
    let createDnsRecord: Bool
    let proxied: Bool
    let status: String // PENDING | ACTIVE | ERROR
    let lastError: String?
    let lastCheckedAt: String?
}

// GET /databases (database-backup.controller.ts:listDatabases) — bancos
// implantados como serviço de projeto (o que aparece na aba "Dados"/backup
// do painel). `status` é o ProjectServiceStatus do serviço (mesmos valores
// de ProjectSummary.status, reaproveita StatusChip).
struct DatabaseServiceSummary: Decodable, Identifiable {
    let id: String
    let applicationId: String
    let deploymentId: String
    let name: String
    let image: String
    let containerName: String
    let status: String
    let publishedPort: Int?
    let project: DatabaseProjectRef
    let hasSchedule: Bool
}

struct DatabaseProjectRef: Decodable {
    let id: String
    let name: String
}

// GET /applications/:appId/deployments/:deploymentId/connection-info
// (applications.service.ts:getConnectionInfo) — host/porta/usuário/banco pra
// conectar de fora; a senha em si vem separada, de .../credentials (dicionário
// solto, ex. {"POSTGRES_PASSWORD": "..."}), por isso não está aqui.
struct DatabaseConnectionInfo: Decodable {
    let host: String
    let port: Int?
    let username: String?
    let database: String?
}

// GET /catalog/applications (catalog.controller.ts) — resumo pra listagem do
// wizard de deploy; `category` decide o filtro (ex. "database").
struct CatalogApplicationSummary: Decodable, Identifiable {
    var id: String { slug }
    let slug: String
    let name: String
    let description: String
    let category: String
    let icon: String
}

// GET /catalog/applications/:slug (catalog.controller.ts) — detalhe usado
// pelo wizard pra montar o formulário de variáveis antes de implantar.
struct CatalogApplicationDetail: Decodable {
    let slug: String
    let name: String
    let description: String
    let services: [CatalogServiceDetail]
}

struct CatalogServiceDetail: Decodable {
    let name: String
    let variables: [CatalogVariable]
}

struct CatalogVariable: Decodable, Identifiable {
    var id: String { key }
    let key: String
    let label: String
    let description: String?
    let type: String // text | password | number | boolean | select
    let options: [String]?
    let `default`: String?
    let required: Bool?
}

struct AlertThresholdPreference: Codable {
    var id: String?
    var userId: String?
    var serverId: String?
    var cpuPercent: Int?
    var memoryPercent: Int?
    var temperatureCelsius: Int?
    var dockerScope: String
    var dockerEnabled: Bool
}

// Corpo de erro do backend: a maioria das respostas 4xx/5xx só tem `message`,
// mas o 401 de 2FA (auth.service.ts:66/70) manda `message` + `reason`
// ("totp_required"/"totp_invalid"). Os dois campos ficam opcionais pra cobrir
// qualquer um dos dois formatos.
struct APIErrorBody: Decodable {
    let message: String?
    let reason: String?
}
