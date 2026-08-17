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

            if let errorMessage {
                Section {
                    Text(errorMessage).foregroundStyle(.red)
                }
            }
        }
        .navigationTitle(project.name)
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
            project = try await client.get("/applications/\(project.id)")
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "Falha ao executar ação"
        }
    }
}

#Preview {
    NavigationStack {
        ProjectDetailView(project: ProjectSummary(id: "1", name: "vortex-admin", status: "RUNNING", tags: [], domains: [ProjectDomain(hostname: "vortex.exemplo.com")]))
    }
    .environment(AppSession())
}
