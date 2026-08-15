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

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val session = AppSession(InstanceStore(SecureStore(applicationContext)))

        setContent {
            CompositionLocalProvider(LocalAppSession provides session) {
                val instances by session.instanceStore.instances.collectAsState()
                if (instances.isEmpty()) {
                    // AddInstanceScreen — Task 5
                } else {
                    // MainNavHost (bottom nav) — Task 6+
                }
            }
        }
    }
}
