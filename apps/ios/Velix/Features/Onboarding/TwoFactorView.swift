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

    var body: some View {
        Form {
            Section {
                if useRecoveryCode {
                    TextField("Código de recuperação", text: $code)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                } else {
                    TextField("Código de 6 dígitos", text: $code)
                        .keyboardType(.numberPad)
                }

                Button(useRecoveryCode ? "Usar código do autenticador" : "Usar código de recuperação") {
                    useRecoveryCode.toggle()
                    code = ""
                    errorMessage = nil
                }
            }

            if let errorMessage {
                Text(errorMessage).foregroundStyle(.red)
            }

            Button {
                Task { await confirm() }
            } label: {
                if isLoading {
                    ProgressView()
                } else {
                    Text("Confirmar")
                }
            }
            .disabled(code.isEmpty || isLoading)
        }
        .navigationTitle("Verificação em duas etapas")
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
