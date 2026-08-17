import SwiftUI

private struct UpdateEnvBody: Encodable {
    let env: [String: String]
}

/// Editor de variáveis de ambiente de uma implantação vinda de repositório —
/// GET/PATCH .../deployments/:id/env (GitDeployService.updateEnv). Salvar
/// recompõe o compose e recria o container no servidor — mesma operação que
/// o painel web faz, só que direto do app.
struct EnvironmentEditorView: View {
    let projectId: String
    let deploymentId: String

    @Environment(AppSession.self) private var session

    @State private var rows: [EnvRow] = []
    @State private var isLoading = true
    @State private var isSaving = false
    @State private var saved = false
    @State private var errorMessage: String?

    private struct EnvRow: Identifiable {
        let id = UUID()
        var key: String
        var value: String
    }

    var body: some View {
        List {
            if isLoading {
                ProgressView()
            } else {
                Section {
                    ForEach($rows) { $row in
                        VStack(alignment: .leading, spacing: 6) {
                            TextField("CHAVE", text: $row.key)
                                .font(.system(size: 13, weight: .semibold, design: .monospaced))
                                .textInputAutocapitalization(.characters)
                                .autocorrectionDisabled()
                            TextField("valor", text: $row.value)
                                .font(.system(size: 14, design: .monospaced))
                                .autocorrectionDisabled()
                                .textInputAutocapitalization(.never)
                        }
                        .padding(.vertical, 2)
                    }
                    .onDelete { rows.remove(atOffsets: $0) }

                    Button {
                        rows.append(EnvRow(key: "", value: ""))
                    } label: {
                        Label("Adicionar variável", systemImage: "plus")
                    }
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage).foregroundStyle(.red)
                    }
                }

                if saved {
                    Section {
                        Label("Salvo — o container está sendo recriado.", systemImage: "checkmark.circle.fill")
                            .foregroundStyle(.green)
                    }
                }

                Section {
                    Button {
                        Task { await save() }
                    } label: {
                        if isSaving {
                            ProgressView().tint(.white)
                        } else {
                            Text("Salvar")
                        }
                    }
                    .buttonStyle(VelixPrimaryButtonStyle(isEnabled: !isSaving))
                    .disabled(isSaving)
                    .listRowInsets(EdgeInsets())
                    .padding(.vertical, 4)
                }
            }
        }
        .navigationTitle("Ambiente")
        .task {
            await load()
        }
    }

    private func load() async {
        guard let client = session.activeAPIClient else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let env: [String: String] = try await client.get("/applications/\(projectId)/deployments/\(deploymentId)/env")
            rows = env.sorted { $0.key < $1.key }.map { EnvRow(key: $0.key, value: $0.value) }
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "Erro ao carregar variáveis"
        }
    }

    private func save() async {
        guard let client = session.activeAPIClient else { return }
        isSaving = true
        errorMessage = nil
        saved = false
        defer { isSaving = false }

        var env: [String: String] = [:]
        for row in rows {
            let key = row.key.trimmingCharacters(in: .whitespaces)
            guard !key.isEmpty else { continue }
            env[key] = row.value
        }

        do {
            let _: EmptyResponse = try await client.patch(
                "/applications/\(projectId)/deployments/\(deploymentId)/env",
                body: UpdateEnvBody(env: env)
            )
            saved = true
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "Falha ao salvar"
        }
    }
}

#Preview {
    NavigationStack {
        EnvironmentEditorView(projectId: "1", deploymentId: "d1")
    }
    .environment(AppSession())
}
