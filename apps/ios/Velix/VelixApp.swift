import SwiftUI

@main
struct VelixApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @State private var session = AppSession()

    var body: some Scene {
        WindowGroup {
            Group {
                if session.hasAnyInstance {
                    MainTabView()
                } else {
                    AddInstanceView()
                }
            }
            .environment(session)
            .task {
                PushManager.shared.instanceStore = session.instanceStore
                if let active = session.instanceStore.activeInstance {
                    await PushManager.shared.registerCurrentToken(for: active, apiClient: session.apiClient(for: active))
                }
            }
        }
    }
}
