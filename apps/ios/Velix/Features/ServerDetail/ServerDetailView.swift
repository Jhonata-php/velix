import SwiftUI
import Charts
import UIKit

struct ServerDetailView: View {
    let server: ServerSummary

    @Environment(AppSession.self) private var session

    @State private var samples: [MetricSample] = []
    @State private var docker: DockerStatusResponse?
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var hasLoadedOnce = false

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
                List {
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

                    Section("Containers") {
                        dockerSection
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
        }
        .navigationTitle(server.name)
        .task {
            await load()
        }
    }

    @ViewBuilder
    private var dockerSection: some View {
        if let docker {
            if !docker.installed {
                Text("Docker não instalado neste servidor.")
                    .foregroundStyle(.secondary)
            } else if let containers = docker.containers, !containers.isEmpty {
                ForEach(containers) { container in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(container.names)
                            .font(.headline)
                        Text(container.image)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        Text(container.status)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            } else {
                Text("Nenhum container em execução.")
                    .foregroundStyle(.secondary)
            }
        } else {
            Text("Status do Docker indisponível.")
                .foregroundStyle(.secondary)
        }
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
            async let dockerTask: DockerStatusResponse = client.get("/servers/\(server.id)/docker/status")
            samples = try await samplesTask
            docker = try await dockerTask
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "Erro ao carregar detalhes do servidor"
        }
    }
}

#Preview {
    NavigationStack {
        ServerDetailView(server: ServerSummary(id: "1", name: "prod-01", status: "ONLINE", publicIp: nil, hostname: nil, dockerInstalled: true, metrics: nil))
    }
    .environment(AppSession())
}
