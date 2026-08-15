import Foundation

enum APIError: Error, LocalizedError {
    case http(status: Int, message: String?)
    case decoding(Error)
    case network(Error)

    var errorDescription: String? {
        switch self {
        case .http(_, let message): return message ?? "Erro ao falar com o servidor"
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
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
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
            throw APIError.http(status: http.statusCode, message: body?.message)
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

    func put<T: Decodable, B: Encodable>(_ path: String, body: B) async throws -> T {
        var request = makeRequest(path: path, method: "PUT")
        request.httpBody = try JSONEncoder().encode(body)
        return try await send(request)
    }

    func delete(_ path: String) async throws {
        let _: EmptyResponse = try await send(makeRequest(path: path, method: "DELETE"))
    }
}

struct EmptyResponse: Decodable {}
