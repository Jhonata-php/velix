import Foundation
import Observation

/// Cliente genérico dos três canais de shell interativo do backend
/// (`terminal-server.ts`): `/terminal` (SSH do servidor), `/db-console`
/// (cliente de linha do banco) e `/service-terminal` (shell dentro de um
/// container de serviço) — mesmo protocolo JSON nos três, só muda o path e
/// os parâmetros da query string. Autenticação por `?token=` (mesmo motivo
/// do OpsSocket: upgrade de WebSocket não aceita header customizado).
///
/// ponytail: entrada por linha (manda a linha inteira + \n no envio), não
/// keystroke a keystroke — cobre comandos normais de shell/SQL, mas não dá
/// pra rodar TUI tipo vim/htop/top. Upgrade: capturar tecla a tecla via
/// `UIKeyCommand`/delegate de `UITextView` se isso vier a fazer falta.
/// Saída renderizada como texto puro, sem interpretar sequências ANSI de
/// cor/cursor além de removê-las — não é um emulador VT100 completo.
@Observable
final class TerminalSocket {
    private(set) var output = ""
    private(set) var isConnected = false
    private(set) var errorMessage: String?

    private var task: URLSessionWebSocketTask?

    func connect(baseURL: URL, path: String, token: String, extraQuery: [String: String]) {
        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else { return }
        components.scheme = components.scheme == "https" ? "wss" : "ws"
        components.path = path
        components.queryItems = [URLQueryItem(name: "token", value: token)]
            + extraQuery.map { URLQueryItem(name: $0.key, value: $0.value) }
        guard let url = components.url else { return }

        output = ""
        errorMessage = nil
        isConnected = true

        let task = URLSession.shared.webSocketTask(with: url)
        self.task = task
        task.resume()
        listen()
    }

    func sendInput(_ text: String) {
        send(["type": "input", "data": text])
    }

    func disconnect() {
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        isConnected = false
    }

    private func send(_ payload: [String: Any]) {
        guard let task, isConnected,
              let data = try? JSONSerialization.data(withJSONObject: payload),
              let text = String(data: data, encoding: .utf8) else { return }
        task.send(.string(text)) { [weak self] error in
            if let error { self?.fail(error.localizedDescription) }
        }
    }

    private func listen() {
        task?.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .failure(let error):
                if self.isConnected { self.fail(error.localizedDescription) }
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
        case "data":
            if let chunk = obj["data"] as? String { output += Self.stripAnsi(chunk) }
        case "error":
            errorMessage = obj["message"] as? String
        case "closed":
            isConnected = false
        default:
            break
        }
    }

    private func fail(_ message: String) {
        errorMessage = message
        isConnected = false
    }

    /// Remove sequências de escape ANSI (cor, cursor) e reduz `\r` a nada —
    /// sem isso, prompts com cor ou barra de progresso viram lixo visual numa
    /// `Text` monoespaçada sem terminal de verdade por trás.
    private static func stripAnsi(_ text: String) -> String {
        var result = text.replacingOccurrences(of: "\r\n", with: "\n")
        result = result.replacingOccurrences(of: "\r", with: "")
        guard let regex = try? NSRegularExpression(pattern: "\u{1B}\\[[0-9;?]*[a-zA-Z]") else { return result }
        let range = NSRange(result.startIndex..., in: result)
        return regex.stringByReplacingMatches(in: result, range: range, withTemplate: "")
    }
}
