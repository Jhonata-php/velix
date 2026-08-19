import SwiftUI

/// Detalhe de um projeto — status, domínios e as três ações de ciclo de vida
/// (POST /applications/:id/start|stop|restart). Tocar num domínio abre ele
/// no navegador do sistema (a única "válvula de escape" que sobra); o resto
/// fica no app, sem redirecionar pra tela web pra gerenciar o projeto.
struct ProjectDetailView: View {
    @Environment(AppSession.self) private var session

    @State private var project: ProjectSummary
    @State private var isBusy = false
    @State private var errorMessage: String?
    @State private var services: [ProjectServiceSummary] = []

    init(project: ProjectSummary) {
        _project = State(initialValue: project)
    }

    var body: some View {
        List {
            Section {
                HStack {
                    Text("Status")
                    Spacer()
                    StatusChip(status: project.status)
                }
                if !project.tags.isEmpty {
                    HStack {
                        Text("Tags")
                        Spacer()
                        Text(project.tags.joined(separator: ", "))
                            .foregroundStyle(.secondary)
                    }
                }
            }

            if !project.domains.isEmpty {
                Section("Domínios") {
                    ForEach(project.domains, id: \.hostname) { domain in
                        Button {
                            openDomain(domain.hostname)
                        } label: {
                            HStack {
                                Text(domain.hostname)
                                Spacer()
                                Image(systemName: "arrow.up.right.square")
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .foregroundStyle(.primary)
                    }
                }
            }

            Section {
                Button {
                    Task { await runAction("start") }
                } label: {
                    Label("Iniciar", systemImage: "play.fill")
                }
                .disabled(isBusy)

                Button {
                    Task { await runAction("restart") }
                } label: {
                    Label("Reiniciar", systemImage: "arrow.clockwise")
                }
                .disabled(isBusy)

                Button {
                    Task { await runAction("stop") }
                } label: {
                    Label("Parar", systemImage: "stop.fill")
                }
                .disabled(isBusy)
                .foregroundStyle(.red)
            }

            if !services.isEmpty {
                Section("Serviços") {
                    ForEach(services) { service in
                        NavigationLink {
                            ProjectServiceDetailView(applicationId: project.id, service: service)
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(service.name)
                                        .font(.system(size: 15, weight: .medium))
                                    Text(service.image)
                                        .font(.system(size: 12, design: .monospaced))
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                }
                                Spacer()
                                StatusChip(status: service.status)
                            }
                        }
                    }
                }
            }

            // Editar env só existe pra implantações vindas de repositório —
            // as do catálogo usam as variáveis do próprio manifesto (ver
            // GitDeployService.updateEnv).
            if let gitDeploymentId {
                Section {
                    NavigationLink {
                        EnvironmentEditorView(projectId: project.id, deploymentId: gitDeploymentId)
                    } label: {
                        Label("Variáveis de ambiente", systemImage: "list.bullet.rectangle")
                    }
                }
            }

            if let errorMessage {
                Section {
                    Text(errorMessage).foregroundStyle(.red)
                }
            }
        }
        .navigationTitle(project.name)
        .task {
            await refresh()
        }
    }

    private var gitDeploymentId: String? {
        project.deployments.first(where: { $0.sourceType == "git" })?.id
    }

    private func refresh() async {
        guard let client = session.activeAPIClient else { return }
        if let fresh: ProjectSummary = try? await client.get("/applications/\(project.id)") {
            project = fresh
        }
        services = (try? await client.get("/applications/\(project.id)/services")) ?? services
    }

    private func openDomain(_ hostname: String) {
        guard let url = URL(string: "https://\(hostname)") else { return }
        UIApplication.shared.open(url)
    }

    private func runAction(_ action: String) async {
        guard let client = session.activeAPIClient else { return }
        isBusy = true
        errorMessage = nil
        defer { isBusy = false }
        do {
            let _: EmptyResponse = try await client.post("/applications/\(project.id)/\(action)")
            await refresh()
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "Falha ao executar ação"
        }
    }
}

/// Detalhe de um serviço (container) dentro de um projeto — ações de ciclo
/// de vida e shell interativo (`/service-terminal`, sem `mode`, cai direto
/// no shell do container em vez do cliente de banco — esse é o console de
/// `DatabaseDetailView`, que passa `mode=db`).
private struct ProjectServiceDetailView: View {
    let applicationId: String
    let service: ProjectServiceSummary

    @Environment(AppSession.self) private var session
    @State private var status: String
    @State private var isBusy = false
    @State private var errorMessage: String?
    @State private var showTerminal = false

    init(applicationId: String, service: ProjectServiceSummary) {
        self.applicationId = applicationId
        self.service = service
        _status = State(initialValue: service.status)
    }

    var body: some View {
        List {
            Section {
                HStack {
                    Text("Status")
                    Spacer()
                    StatusChip(status: status)
                }
                HStack {
                    Text("Imagem")
                    Spacer()
                    Text(service.image)
                        .font(.system(size: 13, design: .monospaced))
                        .foregroundStyle(.secondary)
                }
            }

            Section {
                Button { Task { await runAction("start") } } label: {
                    Label("Iniciar", systemImage: "play.fill")
                }
                .disabled(isBusy)

                Button { Task { await runAction("restart") } } label: {
                    Label("Reiniciar", systemImage: "arrow.clockwise")
                }
                .disabled(isBusy)

                Button { Task { await runAction("stop") } } label: {
                    Label("Parar", systemImage: "stop.fill")
                }
                .disabled(isBusy)
                .foregroundStyle(.red)
            }

            Section {
                Button {
                    showTerminal = true
                } label: {
                    Label("Abrir terminal", systemImage: "terminal")
                }
            }

            if let errorMessage {
                Section {
                    Text(errorMessage).foregroundStyle(.red)
                }
            }
        }
        .navigationTitle(service.name)
        .sheet(isPresented: $showTerminal) {
            NavigationStack {
                TerminalView(
                    title: "Terminal — \(service.name)",
                    path: "/service-terminal",
                    extraQuery: ["applicationId": applicationId, "serviceName": service.name]
                )
                .toolbar {
                    ToolbarItem(placement: .navigationBarLeading) {
                        Button("Fechar") { showTerminal = false }
                    }
                }
            }
        }
    }

    private func runAction(_ action: String) async {
        guard let client = session.activeAPIClient else { return }
        isBusy = true
        errorMessage = nil
        defer { isBusy = false }
        do {
            let _: EmptyResponse = try await client.post("/applications/\(applicationId)/services/\(service.name)/\(action)")
            status = action == "stop" ? "STOPPED" : "RUNNING"
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "Falha ao executar ação"
        }
    }
}

#Preview {
    NavigationStack {
        ProjectDetailView(project: ProjectSummary(
            id: "1", name: "vortex-admin", status: "RUNNING", tags: [],
            domains: [ProjectDomain(hostname: "vortex.exemplo.com")],
            deployments: [ProjectDeploymentSummary(id: "d1", sourceType: "git")]
        ))
    }
    .environment(AppSession())
}
