package com.velix.app.core

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.tasks.await
import kotlinx.serialization.Serializable

@Serializable
private data class RegisterDeviceBody(val platform: String = "android", val fcmToken: String)

/** Registra o token FCM em cada instância logada (mesmo token físico do
 * aparelho, um POST /push/devices por instância — espelha o app iOS).
 *
 * Firebase só existe de verdade se `google-services.json` estava presente no
 * build (ver Task 10 Step 1/app/build.gradle.kts) — sem isso, `FirebaseApp`
 * nunca é inicializado e qualquer chamada a `FirebaseMessaging` derrubaria o
 * app. [configure] é chamado uma única vez em `VelixApplication.onCreate()`
 * com um `Context` de verdade e guarda o resultado num Boolean em cache — daí
 * em diante nenhum outro ponto do app precisa segurar uma referência a
 * `Context` só pra checar isso de novo. */
object PushManager {
    private var firebaseConfigured = false

    var pendingDeepLinkServerId: String? = null
    var pendingDeepLinkInstanceId: String? = null

    fun configure(context: Context) {
        firebaseConfigured = FirebaseApp.getApps(context).isNotEmpty()
    }

    /** `token` pode falhar (ou nunca ter sido emitido) mesmo com Firebase
     * configurado — rede, Play Services ausente no emulador, etc. Falha de
     * registro nunca deve derrubar o fluxo de login/onboarding. */
    suspend fun registerCurrentToken(instance: Instance, apiClient: ApiClient) {
        if (!firebaseConfigured) return
        val token = try { FirebaseMessaging.getInstance().token.await() } catch (e: Exception) { return }
        try {
            apiClient.post<Unit>("/push/devices", RegisterDeviceBody(fcmToken = token))
        } catch (e: Exception) {
            // falha de registro não deve derrubar o fluxo de login/onboarding
        }
    }

    fun handleNotificationTap(serverId: String?, activeInstanceId: String?) {
        pendingDeepLinkServerId = serverId
        pendingDeepLinkInstanceId = activeInstanceId
    }
}
