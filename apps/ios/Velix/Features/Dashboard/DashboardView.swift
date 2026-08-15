import SwiftUI

struct DashboardView: View {
    @Environment(AppSession.self) private var session

    @State private var servers: [ServerSummary] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var hasLoadedOnce = false

    var body: some View {
        NavigationStack {
            Group {
                if session.activeAPIClient == nil {
                    ContentUnavailableView("Nenhuma instância ativa", systemImage: "exclamationmark.triangle")
                } else if isLoading && !hasLoadedOnce {
                    ProgressView("Carregando…")
                } else if let errorMessage {
                    ContentUnavailableView {
                        Label("Erro ao carregar", systemImage: "exclamationmark.triangle")
                    } description: {
                        Text(errorMessage)
                    } actions: {
                        Button("Tentar de novo") {
                            Task { await load() }
                        }
                    }
                } else if servers.isEmpty {
                    ContentUnavailableView("Nenhum servidor", systemImage: "server.rack")
                } else {
                    List(servers) { server in
                        NavigationLink {
                            ServerDetailView(server: server)
                        } label: {
                            ServerRow(server: server)
                        }
                    }
                    .refreshable {
                        await load()
                    }
                }
            }
            .navigationTitle("Servidores")
            .task {
                await load()
            }
        }
    }

    private func load() async {
        guard let client = session.activeAPIClient else { return }
        isLoading = true
        errorMessage = nil
        defer {
            isLoading = false
            hasLoadedOnce = true
        }
        do {
            servers = try await client.get("/servers")
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "Erro ao carregar servidores"
        }
    }
}

#Preview {
    DashboardView()
        .environment(AppSession())
}
