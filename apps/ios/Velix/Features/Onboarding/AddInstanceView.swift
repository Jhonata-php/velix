import SwiftUI

/// Primeira tela do app: usuário digita o domínio da instância Velix própria.
/// Dono do `NavigationPath` que empilha Login → TwoFactor (ver LoginView/TwoFactorView).
struct AddInstanceView: View {
    /// Chamado quando uma instância é adicionada com sucesso (login direto ou
    /// pós-2FA). Default no-op: cobre o uso como view raiz do app (VelixApp),
    /// onde não há sheet pra fechar. Quando apresentada como sheet
    /// (InstanceListView), o chamador passa aqui o que fecha a sheet.
    var onFinished: () -> Void = {}

    @State private var domainText = ""
    @State private var isChecking = false
    @State private var errorMessage: String?
    @State private var path = NavigationPath()
    @FocusState private var fieldFocused: Bool

    private var isEnabled: Bool {
        !domainText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isChecking
    }

    var body: some View {
        NavigationStack(path: $path) {
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

                            TextField("dominio.com", text: $domainText)
                                .keyboardType(.URL)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .focused($fieldFocused)
                                .textFieldStyle(VelixTextFieldStyle(isFocused: fieldFocused))
                                .submitLabel(.go)
                                .onSubmit { Task { await continueTapped() } }

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
            .navigationDestination(for: URL.self) { baseURL in
                LoginView(baseURL: baseURL, path: $path, onFinished: onFinished)
            }
            .navigationDestination(for: TwoFactorRoute.self) { route in
                TwoFactorView(route: route, onFinished: onFinished)
            }
        }
    }

    private func continueTapped() async {
        errorMessage = nil
        guard let baseURL = Self.normalizedURL(from: domainText) else {
            errorMessage = "Domínio inválido"
            return
        }
        isChecking = true
        defer { isChecking = false }
        if await Self.isReachable(baseURL) {
            path.append(baseURL)
        } else {
            errorMessage = "Não foi possível conectar nesse endereço"
        }
    }

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
