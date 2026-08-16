import SwiftUI

/// Dados levados adiante de LoginView pra TwoFactorView — o backend reprocessa
/// o login completo (`POST /auth/login`) com o `totpCode` preenchido.
struct TwoFactorRoute: Hashable {
    let baseURL: URL
    let email: String
    let password: String
    let rememberMe: Bool
}

struct TwoFactorView: View {
    let route: TwoFactorRoute
    /// Ver `AddInstanceView.onFinished` — fecha a sheet (ou no-op na raiz do app).
    var onFinished: () -> Void = {}
    @Environment(AppSession.self) private var session

    @State private var code = ""
    @State private var useRecoveryCode = false
    @State private var isLoading = false
    @State private var errorMessage: String?
    @FocusState private var fieldFocused: Bool

    private var isEnabled: Bool {
        !code.isEmpty && !isLoading
    }

    var body: some View {
        ZStack {
            VelixBackground()

            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    VelixAuthHeader(
                        title: "Verificação em duas etapas",
                        subtitle: useRecoveryCode
                            ? "Digite um dos seus códigos de recuperação."
                            : "Digite o código de 6 dígitos do seu autenticador."
                    )

                    VStack(alignment: .leading, spacing: 8) {
                        Text(useRecoveryCode ? "CÓDIGO DE RECUPERAÇÃO" : "CÓDIGO")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(.secondary)
                            .tracking(0.5)

                        if useRecoveryCode {
                            TextField("xxxxx-xxxxx", text: $code)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .focused($fieldFocused)
                                .textFieldStyle(VelixTextFieldStyle(isFocused: fieldFocused))
                        } else {
                            TextField("000000", text: $code)
                                .keyboardType(.numberPad)
                                .focused($fieldFocused)
                                .textFieldStyle(VelixTextFieldStyle(isFocused: fieldFocused))
                        }

                        Button(useRecoveryCode ? "Usar código do autenticador" : "Usar código de recuperação") {
                            useRecoveryCode.toggle()
                            code = ""
                            errorMessage = nil
                        }
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(VelixTheme.purple)
                        .padding(.top, 2)
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
                        Task { await confirm() }
                    } label: {
                        if isLoading {
                            ProgressView().tint(.white)
                        } else {
                            Text("Confirmar")
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
        .navigationBarTitleDisplayMode(.inline)
    }

    private func confirm() async {
        errorMessage = nil
        isLoading = true
        defer { isLoading = false }

        let client = APIClient(baseURL: route.baseURL)
        do {
            let response: LoginResponse = try await client.post(
                "/auth/login",
                body: LoginRequest(email: route.email, password: route.password, totpCode: code, rememberMe: route.rememberMe)
            )
            if let instance = Instance(baseURL: route.baseURL, loginResponse: response) {
                session.instanceStore.add(instance)
                // Ver LoginView.login() — mesma lógica: registra o push já
                // aqui pra não depender do próximo launch do app.
                await PushManager.shared.registerCurrentToken(for: instance, apiClient: session.apiClient(for: instance))
                onFinished()
            } else {
                errorMessage = "Código inválido"
            }
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "Erro ao confirmar"
        }
    }
}

#Preview {
    NavigationStack {
        TwoFactorView(route: TwoFactorRoute(
            baseURL: URL(string: "https://demo.velix.app")!,
            email: "a@a.com",
            password: "secret",
            rememberMe: true
        ))
    }
    .environment(AppSession())
}
