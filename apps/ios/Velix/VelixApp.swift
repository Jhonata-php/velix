import SwiftUI

@main
struct VelixApp: App {
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
        }
    }
}
