import SwiftUI

/// Aba global "Bancos" — mesma lista de `GET /databases`
/// (database-backup.controller.ts:listDatabases) que alimenta a tela
/// central de bancos do painel web: bancos implantados como serviço de
/// projeto, de qualquer servidor. "Novo banco" reaproveita o
/// `DeployWizardView` filtrado pra categoria "database" do catálogo — é o
/// mesmo mecanismo que `DatabaseCreateWizard.tsx` usa no painel.
struct DatabasesListView: View {
    @Environment(AppSession.self) private var session

    @State private var databases: [DatabaseServiceSummary] = []
    @State private var isLoading = false
    @State private var hasLoadedOnce = false
    @State private var errorMessage: String?
    @State private var showPickServer = false
    @State private var deployServer: ServerSummary?

    var body: some View {
        NavigationStack {
            Group {
                if session.activeAPIClient == nil {
                    ContentUnavailableView("Nenhuma instância ativa", systemImage: "exclamationmark.triangle")
                } else if isLoading && !hasLoadedOnce {
                    ProgressView("Carregando…")
                } else if let errorMessage, databases.isEmpty {
                    ContentUnavailableView {
                        Label("Erro ao carregar", systemImage: "exclamationmark.triangle")
                    } description: {
                        Text(errorMessage)
                    } actions: {
                        Button("Tentar de novo") { Task { await load() } }
                    }
                } else if databases.isEmpty {
                    ContentUnavailableView("Nenhum banco de dados", systemImage: "cylinder.split.1x2")
                } else {
                    List(databases) { database in
                        NavigationLink {
                            DatabaseDetailView(database: database)
                        } label: {
                            DatabaseRow(database: database)
                        }
                    }
                    .refreshable { await load() }
                }
            }
            .navigationTitle("Bancos de dados")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        showPickServer = true
                    } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            .task { await load() }
            .sheet(isPresented: $showPickServer) {
                NavigationStack {
                    PickServerView { server in
                        showPickServer = false
                        deployServer = server
                    }
                }
            }
            .sheet(item: $deployServer) { server in
                NavigationStack {
                    DeployWizardView(server: server, categoryFilter: "database") {
                        Task { await load() }
                    }
                }
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
            databases = try await client.get("/databases")
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "Erro ao carregar bancos de dados"
        }
    }
}

private struct PickServerView: View {
    let onSelect: (ServerSummary) -> Void

    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss

    @State private var servers: [ServerSummary] = []
    @State private var isLoading = false
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if isLoading {
                ProgressView("Carregando…")
            } else if let errorMessage {
                Text(errorMessage).foregroundStyle(.red)
            } else {
                List(servers) { server in
                    Button {
                        onSelect(server)
                    } label: {
                        ServerRow(server: server)
                    }
                    .foregroundStyle(.primary)
                }
            }
        }
        .navigationTitle("Escolher servidor")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancelar") { dismiss() }
            }
        }
        .task { await load() }
    }

    private func load() async {
        guard let client = session.activeAPIClient else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            servers = try await client.get("/servers")
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "Erro ao carregar servidores"
        }
    }
}

private struct DatabaseRow: View {
    let database: DatabaseServiceSummary

    private var engineLabel: String {
        let image = database.image.lowercased()
        if image.contains("postgres") { return "PostgreSQL" }
        if image.contains("mariadb") { return "MariaDB" }
        if image.contains("mysql") { return "MySQL" }
        return database.image
    }

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(database.name)
                    .font(.system(size: 16, weight: .semibold))
                Text("\(database.project.name) · \(engineLabel)")
                    .font(.system(size: 13))
                    .foregroundStyle(.secondary)
            }
            Spacer()
            StatusChip(status: database.status)
        }
        .padding(.vertical, 4)
    }
}

#Preview {
    DatabasesListView()
        .environment(AppSession())
}
