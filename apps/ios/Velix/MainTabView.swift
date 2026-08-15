import SwiftUI

struct MainTabView: View {
    var body: some View {
        TabView {
            DashboardView()
                .tabItem {
                    Label("Dashboard", systemImage: "gauge")
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
