import SwiftUI

struct ServerRow: View {
    let server: ServerSummary

    var body: some View {
        HStack(spacing: 14) {
            ZStack {
                Circle()
                    .fill(statusColor.opacity(0.15))
                    .frame(width: 38, height: 38)
                Image(systemName: "server.rack")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(statusColor)
            }

            VStack(alignment: .leading, spacing: 3) {
                Text(server.name)
                    .font(.system(size: 16, weight: .semibold))
                if let metricsText {
                    Text(metricsText)
                        .font(.system(size: 13))
                        .foregroundStyle(.secondary)
                }
            }

            Spacer()

            Circle()
                .fill(statusColor)
                .frame(width: 8, height: 8)
        }
        .padding(.vertical, 4)
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
            metrics: ServerMetrics(loadAvg: nil, memUsedMb: 2048, memTotalMb: 4096, diskPercent: nil, cpuPercent: 42.3, temperatureCelsius: 55.1)
        ))
        ServerRow(server: ServerSummary(
            id: "2", name: "staging", status: "PENDING", publicIp: nil, hostname: nil,
            dockerInstalled: false, metrics: nil
        ))
        ServerRow(server: ServerSummary(
            id: "3", name: "backup", status: "ERROR", publicIp: nil, hostname: nil,
            dockerInstalled: true,
            metrics: ServerMetrics(loadAvg: nil, memUsedMb: nil, memTotalMb: nil, diskPercent: nil, cpuPercent: 91.0, temperatureCelsius: nil)
        ))
    }
}
