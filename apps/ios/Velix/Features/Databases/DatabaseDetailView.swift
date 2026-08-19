import SwiftUI
import UIKit

/// Detalhe de um banco de dados — status/ações do container, dados de
/// conexão + credenciais, e liga/desliga do backup automático. Destino de
/// backup (FTP/SFTP/S3) continua só no painel web por agora (ver comentário
/// em `DatabaseBackupConfig`).
struct DatabaseDetailView: View {
    let database: DatabaseServiceSummary

    @Environment(AppSession.self) private var session

    @State private var status: String
    @State private var isBusy = false
    @State private var connectionInfo: DatabaseConnectionInfo?
    @State private var credentials: [String: String] = [:]
    @State private var backupEnabled = false
    @State private var backupHour = 3
    @State private var backupMinute = 0
    @State private var retentionDays = 14
    @State private var isSavingBackup = false
    @State private var errorMessage: String?
    @State private var copiedKey: String?
    @State private var showConsole = false

    init(database: DatabaseServiceSummary) {
        self.database = database
        _status = State(initialValue: database.status)
    }

    private var engineLabel: String {
        let image = database.image.lowercased()
        if image.contains("postgres") { return "PostgreSQL" }
        if image.contains("mariadb") { return "MariaDB" }
        if image.contains("mysql") { return "MySQL" }
        return database.image
    }

    var body: some View {
        List {
            Section {
                HStack {
                    Text("Status")
                    Spacer()
                    StatusChip(status: status)
                }
                HStack {
                    Text("Motor")
                    Spacer()
                    Text(engineLabel).foregroundStyle(.secondary)
                }
                HStack {
                    Text("Projeto")
                    Spacer()
                    Text(database.project.name).foregroundStyle(.secondary)
                }
            }

            Section {
                Button { Task { await runAction("start") } } label: {
                    Label("Iniciar", systemImage: "play.fill")
                }
                .disabled(isBusy)

                Button { Task { await runAction("restart") } } label: {
                    Label("Reiniciar", systemImage: "arrow.clockwise")
                }
                .disabled(isBusy)

                Button { Task { await runAction("stop") } } label: {
                    Label("Parar", systemImage: "stop.fill")
                }
                .disabled(isBusy)
                .foregroundStyle(.red)
            }

            Section {
                Button {
                    showConsole = true
                } label: {
                    Label("Abrir console SQL", systemImage: "terminal")
                }
            } footer: {
                Text("Login automático — mesma senha usada pela aplicação, gerada no deploy.")
            }

            if let connectionInfo {
                Section("Conexão") {
                    connectionRow("Host", connectionInfo.host)
                    if let port = connectionInfo.port {
                        connectionRow("Porta", "\(port)")
                    }
                    if let username = connectionInfo.username {
                        connectionRow("Usuário", username)
                    }
                    if let db = connectionInfo.database {
                        connectionRow("Banco", db)
                    }
                    ForEach(credentials.sorted(by: { $0.key < $1.key }), id: \.key) { key, value in
                        connectionRow(key, value, sensitive: true)
                    }
                }
            }

            Section {
                Toggle("Backup automático", isOn: $backupEnabled)
                if backupEnabled {
                    Stepper("Horário: \(String(format: "%02d:%02d", backupHour, backupMinute))", onIncrement: { adjustHour(1) }, onDecrement: { adjustHour(-1) })
                    Stepper("Reter por \(retentionDays) dias", value: $retentionDays, in: 1...365)
                }
                Button {
                    Task { await saveBackupConfig() }
                } label: {
                    if isSavingBackup { ProgressView() } else { Text("Salvar backup") }
                }
                .disabled(isSavingBackup)
            } header: {
                Text("Backup")
            } footer: {
                Text("Destino do backup (FTP/SFTP/S3) continua configurável só pelo painel web.")
            }

            if let errorMessage {
                Section {
                    Text(errorMessage).foregroundStyle(.red)
                }
            }
        }
        .navigationTitle(database.name)
        .task {
            await loadConnection()
            await loadBackupConfig()
        }
        .sheet(isPresented: $showConsole) {
            NavigationStack {
                TerminalView(
                    title: "Console — \(database.name)",
                    path: "/service-terminal",
                    extraQuery: ["applicationId": database.applicationId, "serviceName": database.name, "mode": "db"]
                )
                .toolbar {
                    ToolbarItem(placement: .navigationBarLeading) {
                        Button("Fechar") { showConsole = false }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func connectionRow(_ label: String, _ value: String, sensitive: Bool = false) -> some View {
        Button {
            UIPasteboard.general.string = value
            copiedKey = label
        } label: {
            HStack {
                Text(label)
                Spacer()
                Text(value)
                    .font(.system(size: 13, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Image(systemName: copiedKey == label ? "checkmark" : "doc.on.doc")
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
            }
        }
        .foregroundStyle(.primary)
    }

    private func adjustHour(_ delta: Int) {
        backupHour = (backupHour + delta + 24) % 24
    }

    private func runAction(_ action: String) async {
        guard let client = session.activeAPIClient else { return }
        isBusy = true
        errorMessage = nil
        defer { isBusy = false }
        do {
            let _: EmptyResponse = try await client.post("/applications/\(database.applicationId)/services/\(database.name)/\(action)")
            status = action == "stop" ? "STOPPED" : "RUNNING"
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "Falha ao executar ação"
        }
    }

    private func loadConnection() async {
        guard let client = session.activeAPIClient else { return }
        do {
            async let infoTask: DatabaseConnectionInfo = client.get("/applications/\(database.applicationId)/deployments/\(database.deploymentId)/connection-info")
            async let credsTask: [String: String] = client.get("/applications/\(database.applicationId)/deployments/\(database.deploymentId)/credentials")
            connectionInfo = try await infoTask
            credentials = try await credsTask
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "Erro ao carregar dados de conexão"
        }
    }

    private func loadBackupConfig() async {
        guard let client = session.activeAPIClient else { return }
        do {
            let config: DatabaseBackupConfig = try await client.get("/databases/\(database.id)/backup-config")
            retentionDays = config.retentionDays
            if let scheduledAt = config.scheduledAt {
                backupEnabled = true
                let parts = scheduledAt.split(separator: ":").compactMap { Int($0) }
                if parts.count == 2 {
                    backupHour = parts[0]
                    backupMinute = parts[1]
                }
            } else {
                backupEnabled = false
            }
        } catch {
            // Sem config salva ainda é um estado normal (banco novo) — não é erro pra mostrar.
        }
    }

    private func saveBackupConfig() async {
        guard let client = session.activeAPIClient else { return }
        isSavingBackup = true
        errorMessage = nil
        defer { isSavingBackup = false }
        do {
            let scheduledAt = backupEnabled ? String(format: "%02d:%02d", backupHour, backupMinute) : nil
            let body = SetBackupConfigBody(scheduledAt: scheduledAt, retentionDays: retentionDays)
            let _: DatabaseBackupConfig = try await client.patch("/databases/\(database.id)/backup-config", body: body)
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "Falha ao salvar configuração de backup"
        }
    }
}

#Preview {
    NavigationStack {
        DatabaseDetailView(database: DatabaseServiceSummary(
            id: "1", applicationId: "app1", deploymentId: "dep1", name: "db",
            image: "postgres:16.4", containerName: "meuapp_db", status: "RUNNING",
            publishedPort: nil, project: DatabaseProjectRef(id: "app1", name: "meuapp"), hasSchedule: false
        ))
    }
    .environment(AppSession())
}
