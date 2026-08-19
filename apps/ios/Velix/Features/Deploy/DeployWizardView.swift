import SwiftUI

/// Implantar um app do catálogo num servidor — mesmo mecanismo do
/// `DeployWizard.tsx` do painel web, simplificado num formulário só (sem
/// passos): cria o projeto vazio (`POST /applications`) e implanta pelo
/// canal `/ops` (`service-deploy`), com log ao vivo até terminar.
///
/// ponytail: só catálogo — o wizard de deploy a partir de repositório Git
/// (contas de forja, branches, método de build) fica de fora por agora, é
/// bem mais superfície pra uma primeira versão mobile. Adicionar se um
/// cliente pedir deploy de repo próprio pelo celular. Também não expõe
/// `selectedServices` (instalar só parte de um manifesto multi-serviço) —
/// sempre implanta todos os serviços do manifesto.
struct DeployWizardView: View {
    let server: ServerSummary
    var categoryFilter: String?
    var onDeployed: () -> Void = {}

    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss

    @State private var catalog: [CatalogApplicationSummary] = []
    @State private var isLoadingCatalog = false
    @State private var catalogError: String?
    @State private var selectedSlug: String?
    @State private var detail: CatalogApplicationDetail?
    @State private var projectName = ""
    @State private var variableValues: [String: String] = [:]
    @State private var hostname = ""
    @State private var createDnsRecord = true
    @State private var isDeploying = false
    @State private var errorMessage: String?
    @State private var opsSocket = OpsSocket()
    @State private var showLog = false

    private var filteredCatalog: [CatalogApplicationSummary] {
        guard let categoryFilter else { return catalog }
        return catalog.filter { $0.category == categoryFilter }
    }

    private var selectedApp: CatalogApplicationSummary? {
        catalog.first { $0.slug == selectedSlug }
    }

    private var canDeploy: Bool {
        selectedSlug != nil && !projectName.trimmingCharacters(in: .whitespaces).isEmpty
    }

    var body: some View {
        Form {
            Section("Aplicativo") {
                if isLoadingCatalog {
                    ProgressView()
                } else if let catalogError {
                    Text(catalogError).foregroundStyle(.red)
                } else {
                    Picker("Escolher", selection: $selectedSlug) {
                        Text("Selecione…").tag(String?.none)
                        ForEach(filteredCatalog) { app in
                            Text(app.name).tag(Optional(app.slug))
                        }
                    }
                }
            }

            if selectedSlug != nil {
                Section("Projeto") {
                    TextField("Nome do projeto", text: $projectName)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }

                if let variables = detail?.services.flatMap(\.variables), !variables.isEmpty {
                    Section("Configuração") {
                        ForEach(variables) { variable in
                            variableField(variable)
                        }
                    }
                }

                Section {
                    TextField("app.seudominio.com (opcional)", text: $hostname)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                    if !hostname.trimmingCharacters(in: .whitespaces).isEmpty {
                        Toggle("Criar registro DNS na Cloudflare", isOn: $createDnsRecord)
                    }
                } header: {
                    Text("Domínio")
                } footer: {
                    Text("Deixe em branco pra configurar depois, pela aba Domínios.")
                }
            }

            if let errorMessage {
                Section {
                    Text(errorMessage).foregroundStyle(.red)
                }
            }

            Section {
                Button {
                    Task { await deploy() }
                } label: {
                    if isDeploying {
                        ProgressView()
                    } else {
                        Text("Implantar").frame(maxWidth: .infinity)
                    }
                }
                .disabled(!canDeploy || isDeploying)
            }
        }
        .navigationTitle("Novo serviço")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancelar") { dismiss() }
            }
        }
        .task { await loadCatalog() }
        .onChange(of: selectedSlug) { _, newValue in
            variableValues = [:]
            Task { await loadDetail(newValue) }
        }
        .sheet(isPresented: $showLog) {
            NavigationStack {
                DeployLogView(socket: opsSocket) {
                    showLog = false
                    onDeployed()
                    dismiss()
                }
            }
            .interactiveDismissDisabled(opsSocket.isRunning)
        }
    }

    @ViewBuilder
    private func variableField(_ variable: CatalogVariable) -> some View {
        let binding = Binding<String>(
            get: { variableValues[variable.key] ?? variable.default ?? "" },
            set: { variableValues[variable.key] = $0 }
        )
        switch variable.type {
        case "boolean":
            Toggle(variable.label, isOn: Binding(
                get: { binding.wrappedValue == "true" },
                set: { binding.wrappedValue = $0 ? "true" : "false" }
            ))
        case "select":
            Picker(variable.label, selection: binding) {
                ForEach(variable.options ?? [], id: \.self) { option in
                    Text(option).tag(option)
                }
            }
        case "password":
            SecureField(variable.label, text: binding)
        case "number":
            TextField(variable.label, text: binding)
                .keyboardType(.numberPad)
        default:
            VStack(alignment: .leading, spacing: 4) {
                TextField(variable.label, text: binding)
                if let description = variable.description {
                    Text(description)
                        .font(.system(size: 12))
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private func loadCatalog() async {
        guard let client = session.activeAPIClient else { return }
        isLoadingCatalog = true
        catalogError = nil
        defer { isLoadingCatalog = false }
        do {
            catalog = try await client.get("/catalog/applications")
        } catch {
            catalogError = (error as? LocalizedError)?.errorDescription ?? "Erro ao carregar catálogo"
        }
    }

    private func loadDetail(_ slug: String?) async {
        guard let client = session.activeAPIClient, let slug else {
            detail = nil
            return
        }
        detail = try? await client.get("/catalog/applications/\(slug)")
    }

    private func deploy() async {
        guard let client = session.activeAPIClient,
              let instance = session.instanceStore.activeInstance,
              let slug = selectedSlug else { return }
        isDeploying = true
        errorMessage = nil
        defer { isDeploying = false }
        do {
            struct CreateProjectBody: Encodable { let serverId: String; let name: String }
            struct CreatedProject: Decodable { let id: String }
            let project: CreatedProject = try await client.post(
                "/applications",
                body: CreateProjectBody(serverId: server.id, name: projectName.trimmingCharacters(in: .whitespaces))
            )

            var params: [String: Any] = ["applicationId": project.id, "manifestSlug": slug]
            if !variableValues.isEmpty { params["variables"] = variableValues }
            let trimmedHostname = hostname.trimmingCharacters(in: .whitespaces)
            if !trimmedHostname.isEmpty {
                params["domain"] = ["hostname": trimmedHostname, "createDnsRecord": createDnsRecord]
            }

            showLog = true
            opsSocket.start(baseURL: instance.baseURL, token: instance.accessToken, serverId: server.id, op: "service-deploy", params: params)
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "Falha ao criar projeto"
        }
    }
}

private struct DeployLogView: View {
    var socket: OpsSocket
    let onFinished: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    Text(socket.lines.isEmpty ? "Iniciando…" : socket.lines.joined(separator: "\n"))
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .textSelection(.enabled)
                        .padding(8)
                        .id("bottom")
                }
                .onChange(of: socket.lines.count) {
                    proxy.scrollTo("bottom", anchor: .bottom)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.black)

            if socket.isDone {
                HStack(spacing: 8) {
                    Image(systemName: socket.ok ? "checkmark.circle.fill" : "xmark.circle.fill")
                        .foregroundStyle(socket.ok ? .green : .red)
                    Text(socket.ok ? "Implantado com sucesso" : (socket.errorMessage ?? "Falha na implantação"))
                        .font(.system(size: 13))
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(.bar)
            }
        }
        .navigationTitle(socket.isDone ? (socket.ok ? "Concluído" : "Falhou") : "Implantando…")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button(socket.isDone ? "Concluir" : "Cancelar") {
                    if !socket.isDone { socket.cancel() }
                    onFinished()
                }
            }
        }
    }
}

#Preview {
    NavigationStack {
        DeployWizardView(server: ServerSummary(id: "1", name: "prod-01", status: "ONLINE", publicIp: nil, hostname: nil, dockerInstalled: true, metrics: nil))
    }
    .environment(AppSession())
}
