import SwiftUI

// TODO(Task 7): métricas históricas (Charts) + status do Docker + botão
// "Abrir no navegador". Placeholder só pra destravar a navegação da Task 6.
struct ServerDetailView: View {
    let server: ServerSummary

    var body: some View {
        Text("TODO — Task 7")
            .navigationTitle(server.name)
    }
}

#Preview {
    NavigationStack {
        ServerDetailView(server: ServerSummary(id: "1", name: "prod-01", status: "ONLINE", publicIp: nil, hostname: nil, dockerInstalled: true, metrics: nil))
    }
}
