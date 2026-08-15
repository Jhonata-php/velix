import SwiftUI

struct MainTabView: View {
    var body: some View {
        TabView {
            DashboardView()
                .tabItem {
                    Label("Dashboard", systemImage: "gauge")
                }

            // TODO(Task 8): notificações reais.
            Text("TODO — Task 8")
                .tabItem {
                    Label("Notificações", systemImage: "bell")
                }

            // TODO(Task 9): tela de conta.
            Text("TODO — Task 9")
                .tabItem {
                    Label("Conta", systemImage: "person.crop.circle")
                }
        }
    }
}

#Preview {
    MainTabView()
        .environment(AppSession())
}
