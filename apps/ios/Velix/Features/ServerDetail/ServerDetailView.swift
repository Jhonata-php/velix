import SwiftUI
import Charts
import UIKit

struct ServerDetailView: View {
    let server: ServerSummary

    @Environment(AppSession.self) private var session

    @State private var samples: [MetricSample] = []
    @State private var projects: [ProjectSummary] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var hasLoadedOnce = false
    @State private var selectedTab: Tab = .overview
    @State private var isRebooting = false
    @State private var showRebootConfirm = false
    @State private var rebootMessage: String?
    @State private var showDeploy = false

    private enum Tab: String, CaseIterable {
        case overview = "Visão geral"
        case projects = "Projetos"
        case containers = "Containers"
        case domains = "Domínios"
        case terminal = "Terminal"

        var icon: String {
            switch self {
            case .overview: return "gauge.with.dots.needle.50percent"
            case .projects: return "square.stack.3d.up"
            case .containers: return "shippingbox"
            case .domains: return "network"
            case .terminal: return "terminal"
            }
        }
    }

    var body: some View {
        Group {
            if isLoading && !hasLoadedOnce {
                ProgressView("Carregando…")
            } else if let errorMessage {
                ContentUnavailableView {
                    Label("Erro ao carregar", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(errorMessage)
                } actions: {
                    Button("Tentar de novo") {
                        Task { await load() }
                    }
                }
            } else {
                TabView(selection: $selectedTab) {
                    ForEach(Tab.allCases, id: \.self) { tab in
                        Group {
                            switch tab {
                            case .overview: overviewTab
                            case .projects: projectsTab
                            case .containers: ContainersTabView(server: server)
                            case .domains: DomainsTabView(server: server)
                            case .terminal: TerminalView(server: server)
                            }
                        }
                        .tabItem { Label(tab.rawValue, systemImage: tab.icon) }
                        .tag(tab)
                    }
                }
            }
        }
        .navigationTitle(server.name)
        // A barra de abas própria daqui embaixo é a barra da tela — some a do
        // app (Dashboard/Notificações/Conta) enquanto ela está visível, senão
        // ficam duas empilhadas.
        .toolbar(.hidden, for: .tabBar)
        .task {
            await load()
        }
        .sheet(isPresented: $showDeploy) {
            NavigationStack {
                DeployWizardView(server: server) {
                    Task { await load() }
                }
            }
        }
    }

    // MARK: - Visão geral

    private var overviewTab: some View {
        List {
            Section("Status") {
                statsGrid
            }

            Section("CPU (últimas 24h)") {
                if cpuChartPoints.isEmpty {
                    Text("Sem dados de métricas nesse período.")
                        .foregroundStyle(.secondary)
                } else {
                    Chart(cpuChartPoints) { point in
                        LineMark(
                            x: .value("Horário", point.date),
                            y: .value("CPU %", point.value)
                        )
                    }
                    .frame(height: 200)
                }
            }

            Section("Memória (últimas 24h)") {
                if memoryChartPoints.isEmpty {
                    Text("Sem dados de métricas nesse período.")
                        .foregroundStyle(.secondary)
                } else {
                    Chart(memoryChartPoints) { point in
                        LineMark(
                            x: .value("Horário", point.date),
                            y: .value("Memória %", point.value)
                        )
                    }
                    .frame(height: 200)
                }
            }

            Section {
                Button {
                    openInBrowser()
                } label: {
                    Label("Abrir no navegador", systemImage: "safari")
                }

                Button {
                    showRebootConfirm = true
                } label: {
                    Label(isRebooting ? "Reiniciando…" : "Reiniciar servidor", systemImage: "arrow.triangle.2.circlepath")
                }
                .disabled(isRebooting)
                .foregroundStyle(.red)
            }

            if let rebootMessage {
                Section {
                    Text(rebootMessage).foregroundStyle(.secondary)
                }
            }
        }
        .refreshable {
            await load()
        }
        .confirmationDialog(
            "Reiniciar este servidor agora?",
            isPresented: $showRebootConfirm,
            titleVisibility: .visible
        ) {
            Button("Reiniciar", role: .destructive) {
                Task { await reboot() }
            }
        } message: {
            Text("O servidor fica indisponível por alguns minutos até voltar.")
        }
    }

    private func reboot() async {
        guard let client = session.activeAPIClient else { return }
        isRebooting = true
        rebootMessage = nil
        defer { isRebooting = false }
        do {
            let response: ServerActionResponse = try await client.post("/servers/\(server.id)/reboot")
            rebootMessage = response.message
        } catch {
            rebootMessage = (error as? LocalizedError)?.errorDescription ?? "Falha ao reiniciar servidor"
        }
    }

    private var statsGrid: some View {
        HStack(spacing: 10) {
            StatCard(label: "CPU", value: server.metrics?.cpuPercent.map { "\(Int($0.rounded()))%" } ?? "—")
            StatCard(label: "Memória", value: memoryText)
            StatCard(label: "Disco", value: server.metrics?.diskPercent ?? "—")
        }
        .listRowInsets(EdgeInsets())
        .padding(.vertical, 8)
        .padding(.horizontal, 4)
    }

    private var memoryText: String {
        guard let used = server.metrics?.memUsedMb, let total = server.metrics?.memTotalMb, total > 0 else { return "—" }
        return "\(Int((Double(used) / Double(total) * 100).rounded()))%"
    }

    // MARK: - Projetos

    private var projectsTab: some View {
        List {
            Section {
                Button {
                    showDeploy = true
                } label: {
                    Label("Novo serviço", systemImage: "plus.circle")
                }
            }

            if projects.isEmpty {
                Text("Nenhum projeto implantado neste servidor.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(projects) { project in
                    NavigationLink {
                        ProjectDetailView(project: project)
                    } label: {
                        ProjectRow(project: project)
                    }
                }
            }
        }
        .refreshable {
            await load()
        }
    }

    private struct ChartPoint: Identifiable {
        let id = UUID()
        let date: Date
        let value: Double
    }

    private func chartPoints(_ value: (MetricSample) -> Double?) -> [ChartPoint] {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let fallbackFormatter = ISO8601DateFormatter()
        return samples.compactMap { sample in
            guard let value = value(sample) else { return nil }
            guard let date = formatter.date(from: sample.capturedAt) ?? fallbackFormatter.date(from: sample.capturedAt) else {
                return nil
            }
            return ChartPoint(date: date, value: value)
        }
        .sorted { $0.date < $1.date }
    }

    private var cpuChartPoints: [ChartPoint] {
        chartPoints { $0.cpuPercent }
    }

    private var memoryChartPoints: [ChartPoint] {
        chartPoints { sample in
            guard let used = sample.memUsedMb, let total = sample.memTotalMb, total > 0 else { return nil }
            return Double(used) / Double(total) * 100
        }
    }

    private func openInBrowser() {
        guard let baseURL = session.instanceStore.activeInstance?.baseURL else { return }
        let url = baseURL.appendingPathComponent("servers").appendingPathComponent(server.id)
        UIApplication.shared.open(url)
    }

    private func load() async {
        guard let client = session.activeAPIClient else { return }
        isLoading = true
        errorMessage = nil
        defer {
            isLoading = false
            hasLoadedOnce = true
        }
        do {
            async let samplesTask: [MetricSample] = client.get("/servers/\(server.id)/metrics/history?hours=24")
            async let projectsTask: [ProjectSummary] = client.get("/servers/\(server.id)/applications")
            samples = try await samplesTask
            projects = try await projectsTask
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "Erro ao carregar detalhes do servidor"
        }
    }
}

private struct StatCard: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label.uppercased())
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(.secondary)
                .tracking(0.3)
            Text(value)
                .font(.system(size: 20, weight: .bold))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Color(uiColor: .secondarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

private struct ProjectRow: View {
    let project: ProjectSummary

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(project.name)
                    .font(.system(size: 16, weight: .semibold))
                if let hostname = project.domains.first?.hostname {
                    Text(hostname)
                        .font(.system(size: 13))
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
            StatusChip(status: project.status)
        }
        .padding(.vertical, 4)
    }
}

/// "RUNNING"/"ERROR"/... (ApplicationStatus do backend) → cor + rótulo em
/// português. Compartilhado entre a lista de projetos e o detalhe.
struct StatusChip: View {
    let status: String

    private var color: Color {
        switch status {
        case "RUNNING": return .green
        case "ERROR": return .red
        case "DEPLOYING": return .orange
        default: return .gray // EMPTY, STOPPED, REMOVING
        }
    }

    private var label: String {
        switch status {
        case "RUNNING": return "Rodando"
        case "ERROR": return "Erro"
        case "DEPLOYING": return "Implantando"
        case "STOPPED": return "Parado"
        case "REMOVING": return "Removendo"
        default: return "Vazio"
        }
    }

    var body: some View {
        Text(label)
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(color)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(color.opacity(0.12))
            .clipShape(Capsule())
    }
}

#Preview {
    NavigationStack {
        ServerDetailView(server: ServerSummary(id: "1", name: "prod-01", status: "ONLINE", publicIp: nil, hostname: nil, dockerInstalled: true, metrics: nil))
    }
    .environment(AppSession())
}
