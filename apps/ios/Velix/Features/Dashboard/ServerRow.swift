import SwiftUI

struct ServerRow: View {
    let server: ServerSummary

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Circle()
                .fill(statusColor)
                .frame(width: 10, height: 10)
                .padding(.top, 5)

            VStack(alignment: .leading, spacing: 2) {
                Text(server.name)
                    .font(.body)
                if let metricsText {
                    Text(metricsText)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private var statusColor: Color {
        switch server.status {
        case "ONLINE": return .green
        case "ERROR": return .red
        default: return .gray // OFFLINE, PENDING, e qualquer status desconhecido
        }
    }

    private var metricsText: String? {
        guard let metrics = server.metrics else { return nil }
        var parts: [String] = []
        if let cpu = metrics.cpuPercent {
            parts.append("CPU \(Int(cpu.rounded()))%")
        }
        if let usedMb = metrics.memUsedMb, let totalMb = metrics.memTotalMb, totalMb > 0 {
            let memPercent = Int((Double(usedMb) / Double(totalMb) * 100).rounded())
            parts.append("Mem \(memPercent)%")
        }
        if let temp = metrics.temperatureCelsius {
            parts.append("\(Int(temp.rounded()))°C")
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}

#Preview {
    List {
        ServerRow(server: ServerSummary(
            id: "1", name: "prod-01", status: "ONLINE", publicIp: nil, hostname: nil,
            dockerInstalled: true,
            metrics: ServerMetrics(loadAvg1: nil, memUsedMb: 2048, memTotalMb: 4096, diskPercent: nil, cpuPercent: 42.3, temperatureCelsius: 55.1)
        ))
        ServerRow(server: ServerSummary(
            id: "2", name: "staging", status: "PENDING", publicIp: nil, hostname: nil,
            dockerInstalled: false, metrics: nil
        ))
        ServerRow(server: ServerSummary(
            id: "3", name: "backup", status: "ERROR", publicIp: nil, hostname: nil,
            dockerInstalled: true,
            metrics: ServerMetrics(loadAvg1: nil, memUsedMb: nil, memTotalMb: nil, diskPercent: nil, cpuPercent: 91.0, temperatureCelsius: nil)
        ))
    }
}
