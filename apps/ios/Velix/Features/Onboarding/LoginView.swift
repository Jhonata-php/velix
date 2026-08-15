import SwiftUI

/// Body de `POST /auth/login` — mesmo shape usado pelo login direto e pelo
/// reenvio com `totpCode` depois do TwoFactorView.
struct LoginRequest: Encodable {
    let email: String
    let password: String
    let totpCode: String?
    let rememberMe: Bool
}

struct LoginView: View {
    let baseURL: URL
    @Binding var path: NavigationPath
    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss

    @State private var email = ""
    @State private var password = ""
    @State private var rememberMe = false
    @State private var isLoading = false
    @State private var errorMessage: String?

    var body: some View {
        Form {
            Section {
                TextField("E-mail", text: $email)
                    .textContentType(.username)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                SecureField("Senha", text: $password)
                    .textContentType(.password)
                Toggle("Lembrar de mim", isOn: $rememberMe)
            }

            if let errorMessage {
                Text(errorMessage).foregroundStyle(.red)
            }

            Button {
                Task { await login() }
            } label: {
                if isLoading {
                    ProgressView()
                } else {
                    Text("Entrar")
                }
            }
            .disabled(email.isEmpty || password.isEmpty || isLoading)
        }
        .navigationTitle("Entrar")
    }

    private func login() async {
        errorMessage = nil
        isLoading = true
        defer { isLoading = false }

        let client = APIClient(baseURL: baseURL)
        do {
            let response: LoginResponse = try await client.post(
                "/auth/login",
                body: LoginRequest(email: email, password: password, totpCode: nil, rememberMe: rememberMe)
            )
            // Um 2xx sem token nunca carrega reason de 2FA na prática (o backend
            // manda totp_required/invalid como corpo de um 401, não de sucesso —
            // ver o catch abaixo), então isso aqui é só o fallback genérico.
            if let instance = Instance(baseURL: baseURL, loginResponse: response) {
                session.instanceStore.add(instance)
                dismiss() // no-op quando esta view é a raiz do app (sem sheet pra fechar)
            } else {
                errorMessage = "Não foi possível entrar"
            }
        } catch let APIError.http(_, _, reason) where reason == "totp_required" || reason == "totp_invalid" {
            path.append(TwoFactorRoute(baseURL: baseURL, email: email, password: password, rememberMe: rememberMe))
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "Erro ao entrar"
        }
    }
}

#Preview {
    NavigationStack {
        LoginView(baseURL: URL(string: "https://demo.velix.app")!, path: .constant(NavigationPath()))
    }
    .environment(AppSession())
}
