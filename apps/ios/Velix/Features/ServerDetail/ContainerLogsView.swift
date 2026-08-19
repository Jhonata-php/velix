import SwiftUI

/// Snapshot de log (não streaming) — mesmo endpoint que `ContainerLogsModal.tsx`
/// usa no painel web (`GET .../logs?tail=300`), com botão de atualizar manual
/// em vez de WebSocket: simples o bastante pra diagnóstico rápido pelo celular,
/// sem precisar manter uma conexão viva enquanto a tela está aberta.
struct ContainerLogsView: View {
    let server: ServerSummary
    let container: DockerContainerInfo

    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss

    @State private var logs = ""
    @State private var isLoading = true
    @State private var errorMessage: String?

    private struct LogsResponse: Decodable { let logs: String }

    var body: some View {
        ScrollView {
            if isLoading && logs.isEmpty {
                ProgressView("Carregando…")
                    .frame(maxWidth: .infinity, minHeight: 200)
                    .foregroundStyle(.white)
            } else if let errorMessage, logs.isEmpty {
                Text(errorMessage)
                    .foregroundStyle(.white.opacity(0.7))
                    .padding()
            } else {
                Text(logs.isEmpty ? "(sem saída)" : logs)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
                    .padding()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.black)
        .navigationTitle(container.names)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button {
                    Task { await load() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .disabled(isLoading)
            }
            ToolbarItem(placement: .navigationBarLeading) {
                Button("Fechar") { dismiss() }
            }
        }
        .task { await load() }
    }

    private func load() async {
        guard let client = session.activeAPIClient else { return }
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            let response: LogsResponse = try await client.get("/servers/\(server.id)/docker/containers/\(container.id)/logs?tail=300")
            logs = response.logs
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "Erro ao carregar logs"
        }
    }
}

#Preview {
    NavigationStack {
        ContainerLogsView(
            server: ServerSummary(id: "1", name: "prod-01", status: "ONLINE", publicIp: nil, hostname: nil, dockerInstalled: true, metrics: nil),
            container: DockerContainerInfo(id: "abc123", image: "postgres:16.4", status: "Up 3 hours", names: "meuapp_db")
        )
    }
    .environment(AppSession())
}
