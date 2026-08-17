import SwiftUI

/// Marcador de rota pro passo "Adicionar instância" dentro da pilha da
/// `WelcomeView` — só existe pra dar um tipo a mais pro `navigationDestination`
/// empilhar, o conteúdo em si é `AddInstanceContent`.
private struct AddInstanceRoute: Hashable {}

/// Tela mostrada só no primeiro acesso (nenhuma instância salva ainda) — ver
/// `VelixApp`. Dona da própria `NavigationPath`, empilhando
/// Adicionar instância → Login → 2FA como push nativo (mesmo padrão de
/// `AddInstanceView`, só que hospedado aqui em vez de numa pilha própria —
/// evita aninhar duas `NavigationStack`, que deixava o teclado lento pra
/// abrir no primeiro toque do campo de domínio).
struct WelcomeView: View {
    var onFinished: () -> Void = {}

    @State private var path = NavigationPath()

    var body: some View {
        NavigationStack(path: $path) {
            content
                .navigationDestination(for: AddInstanceRoute.self) { _ in
                    AddInstanceContent(onFinished: onFinished, path: $path)
                }
                .navigationDestination(for: URL.self) { baseURL in
                    LoginView(baseURL: baseURL, path: $path, onFinished: onFinished)
                }
                .navigationDestination(for: TwoFactorRoute.self) { route in
                    TwoFactorView(route: route, onFinished: onFinished)
                }
        }
    }

    private var content: some View {
        ZStack {
            VelixBackground()

            VStack(spacing: 0) {
                Spacer()

                Image("VelixMark")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 88, height: 88)

                Text("Velix")
                    .font(.system(size: 34, weight: .bold))
                    .foregroundStyle(.primary)
                    .padding(.top, 20)

                Text("Bem-vindo")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(VelixTheme.purple)
                    .padding(.top, 6)

                Text("Monitore e gerencie os servidores da sua instância Velix direto do iPhone.")
                    .font(.system(size: 16))
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.top, 12)
                    .padding(.horizontal, 36)

                Spacer()
                Spacer()

                Button("Próximo") {
                    path.append(AddInstanceRoute())
                }
                .buttonStyle(VelixPrimaryButtonStyle())
                .padding(.horizontal, 24)
                .padding(.bottom, 24)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .principal) { Text("") } }
    }
}

#Preview {
    WelcomeView()
        .environment(AppSession())
}
