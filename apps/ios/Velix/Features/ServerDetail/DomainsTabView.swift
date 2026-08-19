import SwiftUI

/// Aba "Domínios" do detalhe do servidor — mesmos endpoints da seção de
/// domínios do servidor no painel web (`GET/POST .../domains`, `GET
/// domains/:id/verify`, `DELETE domains/:id`). A instalação do Traefik em si
/// continua só pelo painel (fica sob o canal `/ops`, fora do escopo do app).
struct DomainsTabView: View {
    let server: ServerSummary

    @Environment(AppSession.self) private var session

    @State private var domains: [ServerDomain] = []
    @State private var isLoading = false
    @State private var hasLoadedOnce = false
    @State private var errorMessage: String?
    @State private var showAdd = false
    @State private var actioningId: String?
    @State private var confirmRemove: ServerDomain?

    var body: some View {
        Group {
            if isLoading && !hasLoadedOnce {
                ProgressView("Carregando…")
            } else if let errorMessage, domains.isEmpty {
                ContentUnavailableView {
                    Label("Erro ao carregar", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(errorMessage)
                } actions: {
                    Button("Tentar de novo") { Task { await load() } }
                }
            } else {
                List {
                    Section {
                        Button {
                            showAdd = true
                        } label: {
                            Label("Adicionar domínio", systemImage: "plus.circle")
                        }
                    }

                    if !domains.isEmpty {
                        Section("Domínios") {
                            ForEach(domains) { domain in
                                DomainRow(
                                    domain: domain,
                                    busy: actioningId == domain.id,
                                    onVerify: { Task { await verify(domain) } },
                                    onRemove: { confirmRemove = domain }
                                )
                            }
                        }
                    }
                }
                .refreshable { await load() }
            }
        }
        .task { await load() }
        .sheet(isPresented: $showAdd) {
            NavigationStack {
                AddDomainView(server: server) {
                    showAdd = false
                    Task { await load() }
                }
            }
        }
        .alert(
            "Remover domínio?",
            isPresented: Binding(get: { confirmRemove != nil }, set: { if !$0 { confirmRemove = nil } })
        ) {
            Button("Cancelar", role: .cancel) { confirmRemove = nil }
            Button("Remover", role: .destructive) {
                if let target = confirmRemove {
                    Task { await remove(target) }
                }
            }
        } message: {
            Text("O domínio \"\(confirmRemove?.hostname ?? "")\" para de rotear — o registro DNS na Cloudflare, se houver, não é removido junto.")
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
            domains = try await client.get("/servers/\(server.id)/domains")
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "Erro ao carregar domínios"
        }
    }

    private func verify(_ domain: ServerDomain) async {
        guard let client = session.activeAPIClient else { return }
        actioningId = domain.id
        defer { actioningId = nil }
        do {
            let _: ServerDomain = try await client.get("/domains/\(domain.id)/verify")
            await load()
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "Falha ao verificar domínio"
        }
    }

    private func remove(_ domain: ServerDomain) async {
        guard let client = session.activeAPIClient else { return }
        actioningId = domain.id
        defer {
            actioningId = nil
            confirmRemove = nil
        }
        do {
            try await client.delete("/domains/\(domain.id)")
            await load()
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "Falha ao remover domínio"
        }
    }
}

private struct DomainRow: View {
    let domain: ServerDomain
    let busy: Bool
    let onVerify: () -> Void
    let onRemove: () -> Void

    private var color: Color {
        switch domain.status {
        case "ACTIVE": return .green
        case "ERROR": return .red
        default: return .orange // PENDING
        }
    }

    private var label: String {
        switch domain.status {
        case "ACTIVE": return "Ativo"
        case "ERROR": return "Erro"
        default: return "Verificando"
        }
    }

    var body: some View {
        HStack(spacing: 12) {
            Circle()
                .fill(color)
                .frame(width: 8, height: 8)

            VStack(alignment: .leading, spacing: 2) {
                Text(domain.hostname)
                    .font(.system(size: 15, weight: .medium))
                    .lineLimit(1)
                Text("Porta \(domain.targetPort) · \(label)")
                    .font(.system(size: 12, design: .monospaced))
                    .foregroundStyle(.secondary)
                if let lastError = domain.lastError {
                    Text(lastError)
                        .font(.system(size: 11))
                        .foregroundStyle(.red)
                        .lineLimit(2)
                }
            }

            Spacer()

            if busy {
                ProgressView()
            } else {
                Menu {
                    Button {
                        onVerify()
                    } label: {
                        Label("Verificar agora", systemImage: "arrow.clockwise")
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

private struct AddDomainView: View {
    let server: ServerSummary
    let onCreated: () -> Void

    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss

    @State private var hostname = ""
    @State private var targetPort = ""
    @State private var createDnsRecord = true
    @State private var proxied = false
    @State private var isSaving = false
    @State private var errorMessage: String?

    private struct CreateDomainBody: Encodable {
        let hostname: String
        let targetPort: Int
        let createDnsRecord: Bool
        let proxied: Bool
    }

    private var canSave: Bool {
        !hostname.trimmingCharacters(in: .whitespaces).isEmpty && Int(targetPort) != nil
    }

    var body: some View {
        Form {
            Section("Domínio") {
                TextField("app.seudominio.com", text: $hostname)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                TextField("Porta de destino (ex.: 3000)", text: $targetPort)
                    .keyboardType(.numberPad)
            }

            Section {
                Toggle("Criar registro DNS na Cloudflare", isOn: $createDnsRecord)
                Toggle("Proxy da Cloudflare (nuvem laranja)", isOn: $proxied)
                    .disabled(!createDnsRecord)
            } footer: {
                Text("Sem uma conta Cloudflare conectada em Configurações, deixe desligado e aponte o DNS manualmente pro IP do servidor.")
            }

            if let errorMessage {
                Section {
                    Text(errorMessage).foregroundStyle(.red)
                }
            }
        }
        .navigationTitle("Novo domínio")
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancelar") { dismiss() }
            }
            ToolbarItem(placement: .confirmationAction) {
                if isSaving {
                    ProgressView()
                } else {
                    Button("Salvar") { Task { await save() } }
                        .disabled(!canSave)
                }
            }
        }
    }

    private func save() async {
        guard let client = session.activeAPIClient, let port = Int(targetPort) else { return }
        isSaving = true
        errorMessage = nil
        defer { isSaving = false }
        do {
            let body = CreateDomainBody(
                hostname: hostname.trimmingCharacters(in: .whitespaces),
                targetPort: port,
                createDnsRecord: createDnsRecord,
                proxied: proxied
            )
            let _: ServerDomain = try await client.post("/servers/\(server.id)/domains", body: body)
            onCreated()
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "Falha ao adicionar domínio"
        }
    }
}

#Preview {
    NavigationStack {
        DomainsTabView(server: ServerSummary(id: "1", name: "prod-01", status: "ONLINE", publicIp: nil, hostname: nil, dockerInstalled: true, metrics: nil))
    }
    .environment(AppSession())
}
