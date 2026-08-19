import SwiftUI

/// Aba "Containers" do detalhe do servidor — lista com iniciar/parar,
/// remover e ver logs. Mesmos endpoints que a aba Docker do painel web usa
/// (`GET .../docker/status`, `.../start`, `.../stop`, `DELETE ...`).
struct ContainersTabView: View {
    let server: ServerSummary

    @Environment(AppSession.self) private var session

    @State private var containers: [DockerContainerInfo] = []
    @State private var dockerInstalled = true
    @State private var isLoading = false
    @State private var hasLoadedOnce = false
    @State private var errorMessage: String?
    @State private var actioningId: String?
    @State private var confirmRemove: DockerContainerInfo?
    @State private var logsTarget: DockerContainerInfo?

    var body: some View {
        Group {
            if !dockerInstalled && hasLoadedOnce {
                ContentUnavailableView(
                    "Docker não instalado",
                    systemImage: "shippingbox",
                    description: Text("Instale o Docker neste servidor pelo painel web antes de gerenciar containers por aqui.")
                )
            } else if isLoading && !hasLoadedOnce {
                ProgressView("Carregando…")
            } else if let errorMessage, containers.isEmpty {
                ContentUnavailableView {
                    Label("Erro ao carregar", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(errorMessage)
                } actions: {
                    Button("Tentar de novo") { Task { await load() } }
                }
            } else if containers.isEmpty {
                ContentUnavailableView("Nenhum container", systemImage: "shippingbox")
            } else {
                List(containers) { container in
                    ContainerRow(
                        container: container,
                        busy: actioningId == container.id,
                        onToggle: { Task { await toggle(container) } },
                        onLogs: { logsTarget = container },
                        onRemove: { confirmRemove = container }
                    )
                }
                .listStyle(.plain)
                .refreshable { await load() }
            }
        }
        .task { await load() }
        .sheet(item: $logsTarget) { container in
            NavigationStack {
                ContainerLogsView(server: server, container: container)
            }
        }
        .alert(
            "Remover container?",
            isPresented: Binding(get: { confirmRemove != nil }, set: { if !$0 { confirmRemove = nil } })
        ) {
            Button("Cancelar", role: .cancel) { confirmRemove = nil }
            Button("Remover", role: .destructive) {
                if let target = confirmRemove {
                    Task { await remove(target) }
                }
            }
        } message: {
            Text("O container \"\(confirmRemove?.names ?? "")\" é removido — se ele tinha dado num volume nomeado, o volume continua existindo. Não dá pra desfazer.")
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
            let status: DockerStatusResponse = try await client.get("/servers/\(server.id)/docker/status")
            dockerInstalled = status.installed
            containers = status.containers ?? []
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "Erro ao carregar containers"
        }
    }

    private func toggle(_ container: DockerContainerInfo) async {
        guard let client = session.activeAPIClient else { return }
        actioningId = container.id
        defer { actioningId = nil }
        do {
            let action = container.isRunning ? "stop" : "start"
            let _: EmptyResponse = try await client.post("/servers/\(server.id)/docker/containers/\(container.id)/\(action)")
            await load()
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "Falha ao executar ação"
        }
    }

    private func remove(_ container: DockerContainerInfo) async {
        guard let client = session.activeAPIClient else { return }
        actioningId = container.id
        defer {
            actioningId = nil
            confirmRemove = nil
        }
        do {
            try await client.delete("/servers/\(server.id)/docker/containers/\(container.id)")
            await load()
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "Falha ao remover"
        }
    }
}

private struct ContainerRow: View {
    let container: DockerContainerInfo
    let busy: Bool
    let onToggle: () -> Void
    let onLogs: () -> Void
    let onRemove: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Circle()
                .fill(container.isRunning ? Color.green : Color.gray)
                .frame(width: 8, height: 8)

            VStack(alignment: .leading, spacing: 2) {
                Text(container.names)
                    .font(.system(size: 15, weight: .medium))
                    .lineLimit(1)
                Text(container.image)
                    .font(.system(size: 12, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer()

            if busy {
                ProgressView()
            } else {
                Menu {
                    Button {
                        onToggle()
                    } label: {
                        Label(container.isRunning ? "Parar" : "Iniciar", systemImage: container.isRunning ? "stop.fill" : "play.fill")
                    }
                    Button {
                        onLogs()
                    } label: {
                        Label("Ver logs", systemImage: "doc.text")
                    }
                    Button(role: .destructive) {
                        onRemove()
                    } label: {
                        Label("Remover", systemImage: "trash")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .font(.system(size: 20))
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, 4)
    }
}

#Preview {
    ContainersTabView(server: ServerSummary(id: "1", name: "prod-01", status: "ONLINE", publicIp: nil, hostname: nil, dockerInstalled: true, metrics: nil))
        .environment(AppSession())
}
