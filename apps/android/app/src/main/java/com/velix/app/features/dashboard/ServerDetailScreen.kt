package com.velix.app.features.dashboard

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier

/** TODO(Task 7): histórico de métricas + status do Docker + "abrir no
 * navegador". Placeholder só pra destravar a navegação da Task 6 — mesmo
 * papel do `ServerDetailView` inicial do app iOS (fda9c40). */
@Composable
fun ServerDetailScreen(serverId: String) {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text("TODO — Task 7")
            Text(serverId, style = MaterialTheme.typography.bodySmall)
        }
    }
}
