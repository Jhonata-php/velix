import Foundation
import FirebaseCore
import FirebaseMessaging

/// Registra o token FCM em cada instância logada (ver spec de UX seção 7 —
/// mesmo token físico do aparelho, uma chamada de POST /push/devices por
/// instância, porque cada backend tem sua própria tabela de DeviceToken).
final class PushManager {
    static let shared = PushManager()

    struct RegisterDeviceBody: Encodable {
        let platform = "ios"
        let fcmToken: String
    }

    /// Setado uma vez em `VelixApp` (e nunca retido fortemente daqui) — só
    /// serve pra `handleNotificationTap` decidir qual instância abrir, ver
    /// abaixo.
    weak var instanceStore: InstanceStore?

    var pendingDeepLinkServerId: String?
    var pendingDeepLinkInstanceId: UUID?

    private init() {}

    /// `fcmToken` pode ser `nil` logo após `registerForRemoteNotifications()`
    /// — o Firebase SDK ainda não recebeu o `apnsToken` de volta do
    /// `AppDelegate` ou ainda não terminou de trocar ele pelo token FCM
    /// (troca é assíncrona). Isso é normal, não um erro: só não registra
    /// nada dessa vez.
    func registerCurrentToken(for instance: Instance, apiClient: APIClient) async {
        // ponytail: Messaging.messaging() dá fatalError se FirebaseApp.configure()
        // nunca rodou (sem GoogleService-Info.plist) — mesma guarda do AppDelegate.
        guard FirebaseApp.app() != nil else { return }
        guard let token = Messaging.messaging().fcmToken else { return }
        _ = try? await apiClient.post("/push/devices", body: RegisterDeviceBody(fcmToken: token)) as EmptyResponse
    }

    /// Deep link ao tocar numa notificação.
    ///
    /// Lacuna conhecida (spec de UX, seção 7): o payload do backend só carrega
    /// `serverId`, nunca um identificador de instância. Como o mesmo token
    /// físico do aparelho é registrado em CADA instância logada (ver
    /// `registerCurrentToken`, chamado uma vez por instância), não dá pra
    /// saber pelo token qual instância mandou o push — só o `serverId` do
    /// payload ajudaria, cruzando com a lista de servidores de cada
    /// instância, e essa lista não é cacheada localmente (fora de escopo
    /// desta task).
    ///
    /// Estratégia best-effort adotada:
    /// - Zero ou uma instância logada: sem ambiguidade — a instância ativa
    ///   (`InstanceStore.activeInstance`) é, por definição, a única.
    /// - Duas ou mais instâncias logadas: ambíguo de verdade. Sem uma busca
    ///   cross-instância (exigiria persistir o `/servers` de cada instância
    ///   localmente), a melhor aproximação é assumir que o push veio da
    ///   instância que já está ativa/em primeiro plano. Pode abrir o
    ///   servidor errado se o push vier de uma instância diferente da ativa
    ///   — limitação conhecida, não resolvida aqui.
    func handleNotificationTap(userInfo: [AnyHashable: Any]) {
        guard let serverId = userInfo["serverId"] as? String else { return }
        pendingDeepLinkServerId = serverId
        pendingDeepLinkInstanceId = instanceStore?.activeInstance?.id
    }
}
