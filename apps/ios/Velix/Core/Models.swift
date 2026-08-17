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

struct ProjectSummary: Decodable, Identifiable {
    let id: String
    let name: String
    let status: String
    let tags: [String]
    let domains: [ProjectDomain]
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
