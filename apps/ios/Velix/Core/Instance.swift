import Foundation
import Observation

struct Instance: Codable, Identifiable, Equatable {
    let id: UUID
    let baseURL: URL
    let displayName: String
    let userEmail: String
    var accessToken: String
}

extension Instance {
    /// Monta a `Instance` a partir da resposta de `/auth/login` (usada tanto no
    /// login direto quanto após confirmar o 2FA — ver Onboarding/LoginView e
    /// Onboarding/TwoFactorView). `nil` se a resposta não trouxer token/usuário.
    init?(baseURL: URL, loginResponse: LoginResponse) {
        guard let token = loginResponse.accessToken, let user = loginResponse.user else { return nil }
        self.init(
            id: UUID(),
            baseURL: baseURL,
            displayName: baseURL.host ?? baseURL.absoluteString,
            userEmail: user.email,
            accessToken: token
        )
    }
}

/// Lista de instâncias Velix logadas (ver spec de UX, seção 2 — "multi-servidor"
/// no app é multi-instância, não multi-servidor dentro de uma instância só).
@Observable
final class InstanceStore {
    private let keychain: KeychainStore
    private let storageKey = "instances"
    private let activeKey = "active-instance-id"

    private(set) var instances: [Instance] = []
    private(set) var activeInstance: Instance?

    init(keychain: KeychainStore) {
        self.keychain = keychain
        load()
    }

    func add(_ instance: Instance) {
        instances.append(instance)
        if activeInstance == nil {
            activeInstance = instance
        }
        persist()
    }

    func remove(_ instance: Instance) {
        instances.removeAll { $0.id == instance.id }
        if activeInstance?.id == instance.id {
            activeInstance = instances.first
        }
        persist()
    }

    func setActive(_ instance: Instance) {
        guard instances.contains(where: { $0.id == instance.id }) else { return }
        activeInstance = instance
        persist()
    }

    func clearAllForTesting() {
        instances = []
        activeInstance = nil
        persist()
    }

    private func persist() {
        if let data = try? JSONEncoder().encode(instances) {
            keychain.save(data, forKey: storageKey)
        }
        if let activeInstance, let idData = activeInstance.id.uuidString.data(using: .utf8) {
            keychain.save(idData, forKey: activeKey)
        } else {
            keychain.delete(forKey: activeKey)
        }
    }

    private func load() {
        guard let data = keychain.read(forKey: storageKey),
              let decoded = try? JSONDecoder().decode([Instance].self, from: data) else { return }
        instances = decoded
        if let idData = keychain.read(forKey: activeKey),
           let idString = String(data: idData, encoding: .utf8),
           let id = UUID(uuidString: idString) {
            activeInstance = instances.first { $0.id == id }
        } else {
            activeInstance = instances.first
        }
    }
}
