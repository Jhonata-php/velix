import Foundation
import Observation

/// Cliente do canal `/ops` (ops-server.ts) — mesmo usado pelo painel web em
/// `OpsLogPanel`/`InstallLogModal`: WebSocket cru, fora do prefixo `/api`,
/// autenticado por `?token=&serverId=` na própria URL (handshake de upgrade
/// não aceita headers customizados). Uma única mensagem `{type:'start', op,
/// params}` dispara a operação; o servidor devolve `{type:'log', data}`
/// repetidos e fecha com `{type:'done', ok, error?}`. Usado por qualquer
/// operação demorada com log ao vivo: deploy de serviço (catálogo ou Git),
/// instalação do Traefik, etc.
@Observable
final class OpsSocket {
    private(set) var lines: [String] = []
    private(set) var isRunning = false
    private(set) var isDone = false
    private(set) var ok = false
    private(set) var errorMessage: String?

    private var task: URLSessionWebSocketTask?

    func start(baseURL: URL, token: String, serverId: String, op: String, params: [String: Any] = [:]) {
        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else { return }
        components.scheme = components.scheme == "https" ? "wss" : "ws"
        components.path = "/ops"
        components.queryItems = [
            URLQueryItem(name: "token", value: token),
            URLQueryItem(name: "serverId", value: serverId),
        ]
        guard let url = components.url else { return }

        lines = []
        isRunning = true
        isDone = false
        ok = false
        errorMessage = nil

        let task = URLSession.shared.webSocketTask(with: url)
        self.task = task
        task.resume()
        listen()

        var payload: [String: Any] = ["type": "start", "op": op]
        if !params.isEmpty { payload["params"] = params }
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let text = String(data: data, encoding: .utf8) else {
            fail("Não foi possível montar a requisição")
            return
        }
        task.send(.string(text)) { [weak self] error in
            if let error { self?.fail(error.localizedDescription) }
        }
    }

    func cancel() {
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        isRunning = false
    }

    private func listen() {
        task?.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .failure(let error):
                if self.isRunning { self.fail(error.localizedDescription) }
            case .success(let message):
                if case .string(let text) = message { self.handle(text) }
                self.listen()
            }
        }
    }

    private func handle(_ text: String) {
        guard let data = text.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = obj["type"] as? String else { return }
        switch type {
        case "log":
            if let line = obj["data"] as? String { lines.append(line) }
        case "done":
            isRunning = false
            isDone = true
            ok = obj["ok"] as? Bool ?? false
            errorMessage = obj["error"] as? String
            task?.cancel(with: .normalClosure, reason: nil)
        default:
            break
        }
    }

    private func fail(_ message: String) {
        isRunning = false
        isDone = true
        ok = false
        errorMessage = message
    }
}
