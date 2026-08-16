package com.velix.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import com.velix.app.core.AppSession
import com.velix.app.core.InstanceStore
import com.velix.app.core.LocalAppSession
import com.velix.app.core.SecureStore
import com.velix.app.features.onboarding.OnboardingNavHost

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val session = AppSession(InstanceStore(SecureStore(applicationContext)))

        setContent {
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
