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
    /// Ver `AddInstanceView.onFinished` — fecha a sheet (ou no-op na raiz do app).
    var onFinished: () -> Void = {}
    @Environment(AppSession.self) private var session

    @State private var email = ""
    @State private var password = ""
    @State private var rememberMe = false
    @State private var isLoading = false
    @State private var errorMessage: String?
    @FocusState private var focusedField: Field?

    private enum Field { case email, password }

    private var isEnabled: Bool {
        !email.isEmpty && !password.isEmpty && !isLoading
    }

    var body: some View {
        ZStack {
            VelixBackground()

            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    VelixAuthHeader(
                        title: "Entrar",
                        subtitle: "Use as mesmas credenciais do painel web em \(baseURL.host ?? baseURL.absoluteString)."
                    )

                    VStack(alignment: .leading, spacing: 16) {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("E-MAIL")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(.secondary)
                                .tracking(0.5)
                            TextField("voce@email.com", text: $email)
                                .textContentType(.username)
                                .keyboardType(.emailAddress)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .focused($focusedField, equals: .email)
                                .textFieldStyle(VelixTextFieldStyle(isFocused: focusedField == .email))
                                .submitLabel(.next)
                                .onSubmit { focusedField = .password }
                        }

                        VStack(alignment: .leading, spacing: 8) {
                            Text("SENHA")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(.secondary)
                                .tracking(0.5)
                            SecureField("••••••••", text: $password)
                                .textContentType(.password)
                                .focused($focusedField, equals: .password)
                                .textFieldStyle(VelixTextFieldStyle(isFocused: focusedField == .password))
                                .submitLabel(.go)
                                .onSubmit { Task { await login() } }
                        }

                        Toggle("Lembrar de mim", isOn: $rememberMe)
                            .font(.system(size: 15))
                            .tint(VelixTheme.purple)
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
                        Task { await login() }
                    } label: {
                        if isLoading {
                            ProgressView().tint(.white)
                        } else {
                            Text("Entrar")
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
                // Registra o push já aqui em vez de esperar o próximo launch
                // (VelixApp.task só cobre a instância ativa no boot) — senão
                // uma segunda instância logada fica sem push até reabrir o app.
                await PushManager.shared.registerCurrentToken(for: instance, apiClient: session.apiClient(for: instance))
                onFinished()
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
