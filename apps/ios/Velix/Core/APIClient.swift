import Foundation

enum APIError: Error, LocalizedError {
    case http(status: Int, message: String?, reason: String?)
    case decoding(Error)
    case network(Error)

    var errorDescription: String? {
        switch self {
        case .http(_, let message, _): return message ?? "Erro ao falar com o servidor"
        case .decoding: return "Resposta inesperada do servidor"
        case .network: return "Sem conexão com o servidor"
        }
    }
}

final class APIClient {
    let baseURL: URL
    var token: String?

    init(baseURL: URL, token: String? = nil) {
        self.baseURL = baseURL
        self.token = token
    }

    func makeRequest(path: String, method: String) -> URLRequest {
        // O backend expõe tudo sob /api (ver `app.setGlobalPrefix('api')` em
        // apps/api/src/main.ts) — sem isso toda chamada cai no Next.js do
        // painel web e volta 404, inclusive o próprio /auth/login.
        var request = URLRequest(url: URL(string: "/api" + path, relativeTo: baseURL)!)
        request.httpMethod = method
        if let token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        return request
    }

    private func send<T: Decodable>(_ request: URLRequest) async throws -> T {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            throw APIError.network(error)
        }
        guard let http = response as? HTTPURLResponse else {
            throw APIError.network(URLError(.badServerResponse))
        }
        guard (200..<300).contains(http.statusCode) else {
            let body = try? JSONDecoder().decode(APIErrorBody.self, from: data)
            throw APIError.http(status: http.statusCode, message: body?.message, reason: body?.reason)
        }
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw APIError.decoding(error)
        }
    }

    func get<T: Decodable>(_ path: String) async throws -> T {
        try await send(makeRequest(path: path, method: "GET"))
    }

    func post<T: Decodable, B: Encodable>(_ path: String, body: B) async throws -> T {
        var request = makeRequest(path: path, method: "POST")
        request.httpBody = try JSONEncoder().encode(body)
        return try await send(request)
    }

    /// Ações sem corpo (start/stop/restart) — sem isso cada chamador teria
    /// que inventar seu próprio `struct Empty: Encodable {}`.
    func post<T: Decodable>(_ path: String) async throws -> T {
        try await send(makeRequest(path: path, method: "POST"))
    }

    func put<T: Decodable, B: Encodable>(_ path: String, body: B) async throws -> T {
        var request = makeRequest(path: path, method: "PUT")
        request.httpBody = try JSONEncoder().encode(body)
        return try await send(request)
    }

    func patch<T: Decodable, B: Encodable>(_ path: String, body: B) async throws -> T {
        var request = makeRequest(path: path, method: "PATCH")
        request.httpBody = try JSONEncoder().encode(body)
        return try await send(request)
    }

    func delete(_ path: String) async throws {
        let _: EmptyResponse = try await send(makeRequest(path: path, method: "DELETE"))
    }
}

struct EmptyResponse: Decodable {}
