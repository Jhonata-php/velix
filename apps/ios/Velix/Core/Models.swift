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

struct ServerMetrics: Decodable {
    let loadAvg1: Double?
    let memUsedMb: Int?
    let memTotalMb: Int?
    let diskPercent: Double?
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

// GET /servers/:id/docker/status (dockerStatus, servers.service.ts:401) não devolve um array
// solto de containers como o rascunho da tarefa assumia — devolve um objeto com
// `installed` e, só quando o Docker está instalado e acessível, `version` +
// `containers`. `parseContainers` (servers.service.ts:419) devolve
// { id, image, status, names } por container — os 4 campos abaixo batem exatamente.
struct DockerStatusResponse: Decodable {
    let installed: Bool
    let version: String?
    let containers: [ContainerStatus]?
}

struct ContainerStatus: Decodable, Identifiable {
    let id: String
    let image: String
    let status: String
    let names: String
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
