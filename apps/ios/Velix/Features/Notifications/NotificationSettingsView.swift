import SwiftUI
import UserNotifications

struct NotificationSettingsView: View {
    @Environment(AppSession.self) private var session

    @State private var servers: [ServerSummary] = []
    @State private var globalPreference: AlertThresholdPreference?
    @State private var isLoadingServers = false
    @State private var errorMessage: String?
    @State private var didRequestNotificationPermission = false

    var body: some View {
        NavigationStack {
            Group {
                if let client = session.activeAPIClient {
                    List {
                        ThresholdEditorView(
                            client: client,
                            serverId: nil,
                            onUpdate: { globalPreference = $0 }
                        )

                        Section("Servidores") {
                            if servers.isEmpty && !isLoadingServers {
                                Text("Nenhum servidor")
                                    .foregroundStyle(.secondary)
                            }
                            ForEach(servers) { server in
                                NavigationLink(server.name) {
                                    List {
                                        ThresholdEditorView(
                                            client: client,
                                            serverId: server.id,
                                            globalDefault: globalPreference
                                        )
                                    }
                                    .navigationTitle(server.name)
                                }
                            }
                            if let errorMessage {
                                Text(errorMessage)
                                    .foregroundStyle(.red)
                                    .font(.footnote)
                            }
                        }
                    }
                    .refreshable {
                        await loadServers()
                    }
                } else {
                    ContentUnavailableView("Nenhuma instância ativa", systemImage: "bell.slash")
                }
            }
            .navigationTitle("Notificações")
            .task {
                await loadServers()
                requestNotificationPermissionOnce()
            }
        }
    }

    private func loadServers() async {
        guard let client = session.activeAPIClient else { return }
        isLoadingServers = true
        errorMessage = nil
        defer { isLoadingServers = false }
        do {
            servers = try await client.get("/servers")
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "Erro ao carregar servidores"
        }
    }

    private func requestNotificationPermissionOnce() {
        guard !didRequestNotificationPermission else { return }
        didRequestNotificationPermission = true
        Task {
            _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
        }
    }
}

#Preview {
    NotificationSettingsView()
        .environment(AppSession())
}
