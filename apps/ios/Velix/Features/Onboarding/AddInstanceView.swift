import SwiftUI

/// Primeira tela do app: usuário digita o domínio da instância Velix própria.
/// Dono do `NavigationPath` que empilha Login → TwoFactor (ver LoginView/TwoFactorView).
/// Usada como raiz própria (sheet de "adicionar instância" em InstanceListView).
/// Quando entra pelo fluxo de primeiro acesso, é `WelcomeView` quem hospeda a
/// pilha e usa `AddInstanceContent` diretamente — ver esse arquivo.
struct AddInstanceView: View {
    /// Chamado quando uma instância é adicionada com sucesso (login direto ou
    /// pós-2FA). Default no-op: cobre o uso como view raiz do app (VelixApp),
    /// onde não há sheet pra fechar. Quando apresentada como sheet
    /// (InstanceListView), o chamador passa aqui o que fecha a sheet.
    var onFinished: () -> Void = {}

    @State private var path = NavigationPath()

    var body: some View {
        NavigationStack(path: $path) {
            AddInstanceContent(onFinished: onFinished, path: $path)
                .navigationDestination(for: URL.self) { baseURL in
                    LoginView(baseURL: baseURL, path: $path, onFinished: onFinished)
                }
                .navigationDestination(for: TwoFactorRoute.self) { route in
                    TwoFactorView(route: route, onFinished: onFinished)
                }
        }
    }
}

/// Formulário de domínio em si, sem `NavigationStack` própria — pra poder ser
/// empilhado dentro da pilha de outra tela (`WelcomeView`) sem aninhar duas
/// `NavigationStack`, que é o que causava o atraso pra abrir o teclado (a
/// troca de view raiz recriava a tela inteira bem na hora do toque).
struct AddInstanceContent: View {
    var onFinished: () -> Void = {}
    @Binding var path: NavigationPath
    @Environment(AppSession.self) private var session

    @State private var domainText = ""
    @State private var isChecking = false
    @State private var errorMessage: String?
    @State private var isScanning = false
    @FocusState private var fieldFocused: Bool

    private var isEnabled: Bool {
        !domainText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isChecking
    }

    var body: some View {
        ZStack {
            VelixBackground()

            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    VelixAuthHeader(
                        title: "Adicionar instância",
                        subtitle: "Informe o domínio do painel Velix que você administra."
                    )

                    VStack(alignment: .leading, spacing: 8) {
                        Text("ENDEREÇO DA INSTÂNCIA")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(.secondary)
                            .tracking(0.5)

                        HStack(spacing: 10) {
                            Image(systemName: "globe")
                                .foregroundStyle(fieldFocused ? VelixTheme.purple : .secondary)
                                .font(.system(size: 16, weight: .medium))

                            TextField("dominio.com", text: $domainText)
                                .keyboardType(.URL)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .focused($fieldFocused)
                                .submitLabel(.go)
                                .onSubmit { Task { await continueTapped() } }
                        }
                        .modifier(VelixFieldContainer(isFocused: fieldFocused))

                        Text("Com ou sem https://, tanto faz.")
                            .font(.system(size: 13))
                            .foregroundStyle(.secondary)
                    }

                    if let errorMessage {
                        HStack(spacing: 8) {
                            Image(systemName: "exclamationmark.triangle.fill")
                            Text(errorMessage)
                        }
                        .font(.system(size: 14))
                        .foregroundStyle(.red)
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.red.opacity(0.08))
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    }

                    Button {
                        Task { await continueTapped() }
                    } label: {
                        if isChecking {
                            ProgressView().tint(.white)
                        } else {
                            Text("Continuar")
                        }
                    }
                    .buttonStyle(VelixPrimaryButtonStyle(isEnabled: isEnabled))
                    .disabled(!isEnabled)

                    Button {
                        isScanning = true
                    } label: {
                        Label("Escanear QR code", systemImage: "qrcode.viewfinder")
                            .font(.system(size: 15, weight: .medium))
                            .frame(maxWidth: .infinity)
                    }
                    .foregroundStyle(VelixTheme.purple)
                    .padding(.vertical, 4)

                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 24)
                .padding(.top, 32)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .principal) { Text("") } }
        .fullScreenCover(isPresented: $isScanning) {
            QRPairingScanView(onResult: handleScanResult)
        }
    }

    /// Mesmo passo final do login por senha (LoginView.login()) — adiciona a
    /// instância e registra o push já aqui, em vez de esperar o próximo launch.
    private func handleScanResult(_ result: Result<Instance, Error>) {
        switch result {
        case .success(let instance):
            session.instanceStore.add(instance)
            Task { await PushManager.shared.registerCurrentToken(for: instance, apiClient: session.apiClient(for: instance)) }
            onFinished()
        case .failure(let error):
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "Não foi possível parear pelo QR code"
        }
    }

    private func continueTapped() async {
        errorMessage = nil
        guard let baseURL = AddInstanceView.normalizedURL(from: domainText) else {
            errorMessage = "Domínio inválido"
            return
        }
        isChecking = true
        defer { isChecking = false }
        if await AddInstanceView.isReachable(baseURL) {
            path.append(baseURL)
        } else {
            errorMessage = "Não foi possível conectar nesse endereço"
        }
    }
}

extension AddInstanceView {
    /// Aceita domínio com ou sem esquema; adiciona `https://` quando ausente.
    static func normalizedURL(from text: String) -> URL? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        let lower = trimmed.lowercased()
        let withScheme = (lower.hasPrefix("http://") || lower.hasPrefix("https://")) ? trimmed : "https://\(trimmed)"
        return URL(string: withScheme)
    }

    /// Qualquer resposta HTTP (mesmo 404/500) conta como "alcançável" — só erro
    /// de rede/DNS (não deu pra nem completar a requisição) conta como falha.
    static func isReachable(_ baseURL: URL) async -> Bool {
        var request = URLRequest(url: baseURL)
        request.httpMethod = "GET"
        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            return response is HTTPURLResponse
        } catch {
            return false
        }
    }
}

#Preview {
    AddInstanceView()
        .environment(AppSession())
}
