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

    private enum Tab: String, CaseIterable {
        case overview = "Visão geral"
        case projects = "Projetos"

        var icon: String {
            switch self {
            case .overview: return "gauge.with.dots.needle.50percent"
            case .projects: return "square.stack.3d.up"
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
                VStack(spacing: 0) {
                    Group {
                        switch selectedTab {
                        case .overview: overviewTab
                        case .projects: projectsTab
                        }
                    }
                    .frame(maxHeight: .infinity)

                    bottomTabBar
                }
            }
        }
        .navigationTitle(server.name)
        .task {
            await load()
        }
    }

    // MARK: - Visão geral

    private var overviewTab: some View {
        List {
            Section("Status") {
                statsGrid
            }

            Section("CPU (últimas 24h)") {
                if chartPoints.isEmpty {
                    Text("Sem dados de métricas nesse período.")
                        .foregroundStyle(.secondary)
                } else {
                    Chart(chartPoints) { point in
                        LineMark(
                            x: .value("Horário", point.date),
                            y: .value("CPU %", point.cpuPercent)
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
            }
        }
        .refreshable {
            await load()
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
            if projects.isEmpty {
                Text("Nenhum projeto implantado neste servidor.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(projects) { project in
                    Button {
                        openInBrowser()
                    } label: {
                        ProjectRow(project: project)
                    }
                    .foregroundStyle(.primary)
                }
            }
        }
        .refreshable {
            await load()
        }
    }

    // MARK: - Barra de abas

    private var bottomTabBar: some View {
        HStack(spacing: 0) {
            ForEach(Tab.allCases, id: \.self) { tab in
                Button {
                    selectedTab = tab
                } label: {
                    VStack(spacing: 4) {
                        Image(systemName: tab.icon)
                            .font(.system(size: 19, weight: .medium))
                        Text(tab.rawValue)
                            .font(.system(size: 11, weight: .medium))
                    }
                    .foregroundStyle(selectedTab == tab ? VelixTheme.purple : .secondary)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 8)
                }
            }
        }
        .padding(.bottom, 4)
        .background(.bar)
        .overlay(alignment: .top) { Divider() }
    }

    private struct ChartPoint: Identifiable {
        let id = UUID()
        let date: Date
        let cpuPercent: Double
    }

    private var chartPoints: [ChartPoint] {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let fallbackFormatter = ISO8601DateFormatter()
        return samples.compactMap { sample in
            guard let cpuPercent = sample.cpuPercent else { return nil }
            guard let date = formatter.date(from: sample.capturedAt) ?? fallbackFormatter.date(from: sample.capturedAt) else {
                return nil
            }
            return ChartPoint(date: date, cpuPercent: cpuPercent)
        }
        .sorted { $0.date < $1.date }
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
            statusBadge
        }
        .padding(.vertical, 4)
    }

    private var statusColor: Color {
        switch project.status {
        case "RUNNING": return .green
        case "ERROR": return .red
        case "DEPLOYING": return .orange
        default: return .gray // EMPTY, STOPPED, REMOVING
        }
    }

    private var statusLabel: String {
        switch project.status {
        case "RUNNING": return "Rodando"
        case "ERROR": return "Erro"
        case "DEPLOYING": return "Implantando"
        case "STOPPED": return "Parado"
        case "REMOVING": return "Removendo"
        default: return "Vazio"
        }
    }

    private var statusBadge: some View {
        Text(statusLabel)
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(statusColor)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(statusColor.opacity(0.12))
            .clipShape(Capsule())
    }
}

#Preview {
    NavigationStack {
        ServerDetailView(server: ServerSummary(id: "1", name: "prod-01", status: "ONLINE", publicIp: nil, hostname: nil, dockerInstalled: true, metrics: nil))
    }
    .environment(AppSession())
}
