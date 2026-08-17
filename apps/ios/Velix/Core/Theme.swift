import SwiftUI

/// Linguagem visual compartilhada por todo o app — cor de marca, espaçamento,
/// e os dois componentes que toda tela de formulário usa (campo de texto e
/// botão primário). Centralizado aqui pra ficar impossível uma tela nova
/// "esquecer" o estilo e cair no visual padrão do sistema.
enum VelixTheme {
    static let purple = Color(red: 124 / 255, green: 58 / 255, blue: 237 / 255)
    static let purpleDark = Color(red: 91 / 255, green: 33 / 255, blue: 182 / 255)
    static let cornerRadius: CGFloat = 14
}

/// Fundo padrão de tela: branco levemente puxado pra lilás no topo, quase
/// imperceptível — o mesmo espírito do gradiente sutil do painel web, sem
/// competir com o conteúdo.
struct VelixBackground: View {
    var body: some View {
        LinearGradient(
            colors: [VelixTheme.purple.opacity(0.08), Color(uiColor: .systemBackground)],
            startPoint: .top,
            endPoint: .bottom
        )
        .ignoresSafeArea()
    }
}

/// Moldura visual compartilhada por `VelixTextFieldStyle` (campo isolado) e por
/// campos compostos com ícone (ex.: domínio em `AddInstanceContent`), que não
/// dá pra estilizar via `TextFieldStyle` porque o `HStack` inteiro (ícone +
/// campo) precisa da mesma moldura, não só o `TextField`.
struct VelixFieldContainer: ViewModifier {
    var isFocused: Bool = false

    func body(content: Content) -> some View {
        content
            .padding(.horizontal, 14)
            .padding(.vertical, 14)
            .background(Color(uiColor: .secondarySystemBackground))
            .clipShape(RoundedRectangle(cornerRadius: VelixTheme.cornerRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: VelixTheme.cornerRadius, style: .continuous)
                    .strokeBorder(isFocused ? VelixTheme.purple : Color.primary.opacity(0.08), lineWidth: isFocused ? 1.5 : 1)
            )
            .shadow(color: .black.opacity(isFocused ? 0.06 : 0.03), radius: isFocused ? 8 : 4, y: 2)
    }
}

struct VelixTextFieldStyle: TextFieldStyle {
    var isFocused: Bool = false

    func _body(configuration: TextField<Self._Label>) -> some View {
        configuration.modifier(VelixFieldContainer(isFocused: isFocused))
    }
}

/// Botão de ação principal — roxo cheio quando habilitado, cinza neutro (não
/// um roxo lavado) quando desabilitado, pra ficar óbvio que não vai reagir ao
/// toque.
struct VelixPrimaryButtonStyle: ButtonStyle {
    var isEnabled: Bool = true

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 16, weight: .semibold))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 15)
            .foregroundStyle(.white)
            .background(
                Group {
                    if isEnabled {
                        LinearGradient(colors: [VelixTheme.purple, VelixTheme.purpleDark], startPoint: .top, endPoint: .bottom)
                    } else {
                        LinearGradient(colors: [Color.gray.opacity(0.35)], startPoint: .top, endPoint: .bottom)
                    }
                }
            )
            .clipShape(RoundedRectangle(cornerRadius: VelixTheme.cornerRadius, style: .continuous))
            .shadow(color: isEnabled ? VelixTheme.purple.opacity(0.35) : .clear, radius: 12, y: 6)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
}

/// Cabeçalho repetido em toda tela de onboarding: marca + título + subtítulo,
/// com controle real de quebra de linha (sem o corte de `.navigationTitle`
/// grande quando o texto não cabe).
struct VelixAuthHeader: View {
    let title: String
    let subtitle: String

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            // eslint: mark da marca — mesmo arquivo usado no ícone do app.
            // swiftlint:disable:next force_unwrapping
            Image("VelixMark")
                .resizable()
                .scaledToFit()
                .frame(width: 40, height: 40)
                .padding(.bottom, 4)

            Text(title)
                .font(.system(size: 28, weight: .bold))
                .foregroundStyle(.primary)
                .fixedSize(horizontal: false, vertical: true)

            Text(subtitle)
                .font(.system(size: 15))
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
