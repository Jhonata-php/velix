import SwiftUI

struct MainTabView: View {
    var body: some View {
        TabView {
            DashboardView()
                .tabItem {
                    Label("Dashboard", systemImage: "gauge")
                }

            DatabasesListView()
                .tabItem {
                    Label("Bancos", systemImage: "cylinder.split.1x2")
                }

            NotificationSettingsView()
                .tabItem {
                    Label("Notificações", systemImage: "bell")
                }

            InstanceListView()
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
