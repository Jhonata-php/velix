import SwiftUI

/// Editor de limites de alerta reusado tanto pro padrão global (`serverId: nil`)
/// quanto pro override de um servidor específico — o único ponto que muda
/// entre os dois contextos é qual endpoint é chamado, a UI é idêntica.
///
/// Não é um `List`/`Form` próprio de propósito: o conteúdo (`Section`s) é
/// pensado pra ser colocado dentro do `List` de quem chama, seja embutido no
/// topo de `NotificationSettingsView` (bloco "Padrão") ou como tela cheia por
/// trás de um `NavigationLink` (override de servidor).
struct ThresholdEditorView: View {
    let client: APIClient
    let serverId: String?

    /// Valores globais atuais, usados só pelo botão "Usar o padrão" quando
    /// este editor é um override de servidor (`serverId != nil`).
    var globalDefault: AlertThresholdPreference?

    /// Chamado depois de todo load/save bem-sucedido, com os valores mais
    /// recentes — permite que `NotificationSettingsView` capture o padrão
    /// global assim que ele carrega, pra usar como `globalDefault` nos
    /// editores de servidor.
    var onUpdate: ((AlertThresholdPreference?) -> Void)?

    @State private var isLoading = true
    @State private var isSaving = false
    @State private var errorMessage: String?

    @State private var cpuEnabled = false
    @State private var cpuValue = 80
    @State private var memoryEnabled = false
    @State private var memoryValue = 80
    @State private var temperatureEnabled = false
    @State private var temperatureValue = 70
    @State private var dockerEnabled = false
    @State private var dockerScope = "all"

    var body: some View {
        Group {
            Section {
                if isLoading {
                    ProgressView()
                } else {
                    thresholdRow(label: "CPU", enabled: $cpuEnabled, value: $cpuValue, unit: "%", range: 1...100)
                    thresholdRow(label: "Memória", enabled: $memoryEnabled, value: $memoryValue, unit: "%", range: 1...100)
                    thresholdRow(label: "Temperatura", enabled: $temperatureEnabled, value: $temperatureValue, unit: "°C", range: 0...120)
                }
            } header: {
                Text("Limites de alerta")
            }

            Section {
                Toggle("Alertar sobre containers", isOn: $dockerEnabled)
                Picker("Escopo", selection: $dockerScope) {
                    Text("Todos os containers").tag("all")
                    Text("Só minhas aplicações").tag("managed_apps")
                }
                .disabled(!dockerEnabled)
            } header: {
                Text("Containers")
            }

            Section {
                if let errorMessage {
                    Text(errorMessage)
                        .foregroundStyle(.red)
                        .font(.footnote)
                }
                Button {
                    Task { await save() }
                } label: {
                    if isSaving {
                        ProgressView()
                    } else {
                        Text("Salvar")
                    }
                }
                .disabled(isSaving || isLoading)

                if serverId != nil {
                    Button("Usar o padrão") {
                        Task { await useGlobalDefault() }
                    }
                    .disabled(isSaving || isLoading || globalDefault == nil)
                }
            }
        }
        .task {
            await load()
        }
    }

    @ViewBuilder
    private func thresholdRow(label: String, enabled: Binding<Bool>, value: Binding<Int>, unit: String, range: ClosedRange<Int>) -> some View {
        Toggle(label, isOn: enabled)
        if enabled.wrappedValue {
            Stepper("\(value.wrappedValue)\(unit)", value: value, in: range)
        }
    }

    private var path: String {
        if let serverId {
            return "/servers/\(serverId)/alerts/thresholds"
        }
        return "/alerts/thresholds"
    }

    private func load() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            let preference: AlertThresholdPreference? = try await client.get(path)
            apply(preference)
            onUpdate?(preference)
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "Erro ao carregar limites"
        }
    }

    private func apply(_ preference: AlertThresholdPreference?) {
        cpuEnabled = preference?.cpuPercent != nil
        cpuValue = preference?.cpuPercent ?? 80
        memoryEnabled = preference?.memoryPercent != nil
        memoryValue = preference?.memoryPercent ?? 80
        temperatureEnabled = preference?.temperatureCelsius != nil
        temperatureValue = preference?.temperatureCelsius ?? 70
        dockerEnabled = preference?.dockerEnabled ?? false
        dockerScope = preference?.dockerScope ?? "all"
    }

    private func save() async {
        let body = ThresholdUpdateBody(
            cpuPercent: cpuEnabled ? cpuValue : nil,
            memoryPercent: memoryEnabled ? memoryValue : nil,
            temperatureCelsius: temperatureEnabled ? temperatureValue : nil,
            dockerScope: dockerScope,
            dockerEnabled: dockerEnabled
        )
        await submit(body)
    }

    /// "Usar o padrão": a API não tem endpoint pra remover um override e
    /// voltar a herdar o global (ver plano, Task 8) — então a única forma de
    /// "resetar" hoje é copiar os valores globais atuais pro override deste
    /// servidor via PUT.
    private func useGlobalDefault() async {
        guard let globalDefault else { return }
        let body = ThresholdUpdateBody(
            cpuPercent: globalDefault.cpuPercent,
            memoryPercent: globalDefault.memoryPercent,
            temperatureCelsius: globalDefault.temperatureCelsius,
            dockerScope: globalDefault.dockerScope,
            dockerEnabled: globalDefault.dockerEnabled
        )
        await submit(body)
    }

    private func submit(_ body: ThresholdUpdateBody) async {
        isSaving = true
        errorMessage = nil
        defer { isSaving = false }
        do {
            let updated: AlertThresholdPreference = try await client.put(path, body: body)
            apply(updated)
            onUpdate?(updated)
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "Erro ao salvar limites"
        }
    }
}

private struct ThresholdUpdateBody: Encodable {
    var cpuPercent: Int?
    var memoryPercent: Int?
    var temperatureCelsius: Int?
    var dockerScope: String?
    var dockerEnabled: Bool?
}

#Preview {
    List {
        ThresholdEditorView(client: APIClient(baseURL: URL(string: "https://example.com")!), serverId: nil)
    }
}
