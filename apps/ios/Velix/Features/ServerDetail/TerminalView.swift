import SwiftUI

/// Shell interativo genérico via WebSocket — usado tanto pela aba "Terminal"
/// do servidor (`/terminal`, SSH direto) quanto pelo console SQL de um banco
/// (`/service-terminal?mode=db`, ver DatabaseDetailView). Mesmo protocolo
/// nos dois casos (terminal-server.ts), só muda o path/query. Ver ponytail
/// em TerminalSocket: entrada por linha, não keystroke a keystroke — cobre
/// diagnóstico e comandos comuns, não substitui um cliente completo pra apps
/// de tela cheia (vim, htop).
struct TerminalView: View {
    let title: String
    let path: String
    let extraQuery: [String: String]

    @Environment(AppSession.self) private var session
    @State private var socket = TerminalSocket()
    @State private var input = ""

    init(server: ServerSummary) {
        title = server.name
        path = "/terminal"
        extraQuery = ["serverId": server.id]
    }

    init(title: String, path: String, extraQuery: [String: String]) {
        self.title = title
        self.path = path
        self.extraQuery = extraQuery
    }

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
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { connect() }
        .onDisappear { socket.disconnect() }
    }

    private func connect() {
        guard let instance = session.instanceStore.activeInstance else { return }
        socket.connect(baseURL: instance.baseURL, path: path, token: instance.accessToken, extraQuery: extraQuery)
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
