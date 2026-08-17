package com.velix.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.lifecycle.lifecycleScope
import com.velix.app.core.AppSession
import com.velix.app.core.InstanceStore
import com.velix.app.core.LocalAppSession
import com.velix.app.core.PushManager
import com.velix.app.core.SecureStore
import com.velix.app.features.onboarding.OnboardingNavHost
import com.velix.app.ui.theme.VelixTheme
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private val session by lazy { AppSession(InstanceStore(SecureStore(applicationContext))) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        handleNotificationIntent(intent)

        session.instanceStore.activeInstance.value?.let { active ->
            lifecycleScope.launch {
                PushManager.registerCurrentToken(active, session.apiClient(active))
            }
        }

        setContent {
            VelixTheme {
                CompositionLocalProvider(LocalAppSession provides session) {
                    val instances by session.instanceStore.instances.collectAsState()
                    if (instances.isEmpty()) {
                        // onFinished no-op: instanceStore.add() já dispara a
                        // recomposição acima pra sair da árvore de onboarding
                        // (instances deixa de estar vazia) — nada explícito a fazer aqui.
                        OnboardingNavHost(onFinished = {})
                    } else {
                        MainNavHost()
                    }
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleNotificationIntent(intent)
    }

    /** FCM inclui os campos do payload "data" como extras do `Intent` que abre
     * a activity ao tocar na notificação (comportamento padrão do SO pra
     * apps em background/killed) — nenhum parsing de payload manual aqui. */
    private fun handleNotificationIntent(intent: Intent) {
        val serverId = intent.getStringExtra("serverId") ?: return
        PushManager.handleNotificationTap(serverId, session.instanceStore.activeInstance.value?.id)
    }
}
