import SwiftUI

/// Primeira tela do app: usuário digita o domínio da instância Velix própria.
/// Dono do `NavigationPath` que empilha Login → TwoFactor (ver LoginView/TwoFactorView).
struct AddInstanceView: View {
    @State private var domainText = ""
    @State private var isChecking = false
    @State private var errorMessage: String?
    @State private var path = NavigationPath()

    var body: some View {
        NavigationStack(path: $path) {
            Form {
                Section {
                    TextField("dominio.com", text: $domainText)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                } header: {
                    Text("Endereço da instância")
                } footer: {
                    Text("Com ou sem https://, tanto faz.")
                }

                if let errorMessage {
                    Text(errorMessage).foregroundStyle(.red)
                }

                Button {
                    Task { await continueTapped() }
                } label: {
                    if isChecking {
                        ProgressView()
                    } else {
                        Text("Continuar")
                    }
                }
                .disabled(domainText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isChecking)
            }
            .navigationTitle("Adicionar instância")
            .navigationDestination(for: URL.self) { baseURL in
                LoginView(baseURL: baseURL, path: $path)
            }
            .navigationDestination(for: TwoFactorRoute.self) { route in
                TwoFactorView(route: route)
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
