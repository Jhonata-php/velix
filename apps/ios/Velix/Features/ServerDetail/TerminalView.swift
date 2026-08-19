import SwiftUI

/// Aba "Terminal" do detalhe do servidor — SSH interativo via `/terminal`
/// (terminal-server.ts:handleConnection). Ver ponytail em TerminalSocket:
/// entrada por linha, não keystroke a keystroke — cobre diagnóstico e
/// comandos comuns, não substitui um cliente SSH completo pra apps de tela
/// cheia (vim, htop).
struct TerminalView: View {
    let server: ServerSummary

    @Environment(AppSession.self) private var session
    @State private var socket = TerminalSocket()
    @State private var input = ""

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    Text(socket.output.isEmpty ? "Conectando…" : socket.output)
                        .font(.system(size: 12, design: .monospaced))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .textSelection(.enabled)
                        .padding(8)
                        .id("bottom")
                }
                .onChange(of: socket.output) {
                    proxy.scrollTo("bottom", anchor: .bottom)
                }
            }
            .background(Color.black)

            if let errorMessage = socket.errorMessage {
                Text(errorMessage)
                    .font(.system(size: 12))
                    .foregroundStyle(.red)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
            }

            HStack(spacing: 8) {
                TextField("comando", text: $input)
                    .font(.system(size: 14, design: .monospaced))
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .onSubmit(send)
                Button {
                    send()
                } label: {
                    Image(systemName: "return")
                }
                .disabled(input.isEmpty || !socket.isConnected)
            }
            .padding(10)
            .background(.bar)
        }
        .onAppear { connect() }
        .onDisappear { socket.disconnect() }
    }

    private func connect() {
        guard let instance = session.instanceStore.activeInstance else { return }
        socket.connect(baseURL: instance.baseURL, path: "/terminal", token: instance.accessToken, extraQuery: ["serverId": server.id])
    }

    private func send() {
        guard !input.isEmpty else { return }
        socket.sendInput(input + "\n")
        input = ""
    }
}

#Preview {
    TerminalView(server: ServerSummary(id: "1", name: "prod-01", status: "ONLINE", publicIp: nil, hostname: nil, dockerInstalled: true, metrics: nil))
        .environment(AppSession())
}
