import Foundation
import Observation

@Observable
final class AppSession {
    let instanceStore: InstanceStore

    init(instanceStore: InstanceStore = InstanceStore(keychain: KeychainStore(service: "com.velix.app"))) {
        self.instanceStore = instanceStore
    }

    var hasAnyInstance: Bool {
        !instanceStore.instances.isEmpty
    }

    func apiClient(for instance: Instance) -> APIClient {
        APIClient(baseURL: instance.baseURL, token: instance.accessToken)
    }

    var activeAPIClient: APIClient? {
        guard let active = instanceStore.activeInstance else { return nil }
        return apiClient(for: active)
    }
}
