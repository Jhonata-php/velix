package com.velix.app.features.notifications

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.velix.app.core.AlertThresholdPreference
import com.velix.app.core.ApiException
import com.velix.app.core.LocalAppSession
import com.velix.app.core.ServerSummary
import kotlinx.coroutines.launch

/**
 * Tela "Notificações": bloco "Padrão" no topo ([ThresholdEditor] sem
 * `serverId`) seguido da lista de servidores — clicar num servidor expande
 * um [ThresholdEditor] com override daquele servidor (sem precisar de uma
 * rota de navegação nova só pra isso). Pede permissão de notificação
 * (`POST_NOTIFICATIONS`, obrigatória a partir do Android 13/API 33) na
 * primeira vez que esta tela aparece. Espelha `NotificationSettingsView` do
 * app iOS.
 */
@Composable
fun NotificationSettingsScreen() {
    val session = LocalAppSession.current
    val client = session.activeApiClient

    var servers by remember { mutableStateOf<List<ServerSummary>>(emptyList()) }
    var globalPreference by remember { mutableStateOf<AlertThresholdPreference?>(null) }
    var isLoadingServers by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var expandedServerId by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    val permissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}

    suspend fun loadServers() {
        if (client == null) return
        isLoadingServers = true
        errorMessage = null
        try {
            servers = client.get("/servers")
        } catch (e: ApiException) {
            errorMessage = e.message ?: "Erro ao carregar servidores"
        } finally {
            isLoadingServers = false
        }
    }

    LaunchedEffect(client) {
        loadServers()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            permissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    Column(modifier = Modifier.fillMaxSize()) {
        Text(
            "Notificações",
            style = MaterialTheme.typography.headlineSmall,
            modifier = Modifier.padding(24.dp),
        )
        Box(modifier = Modifier.weight(1f).fillMaxSize()) {
            if (client == null) {
                Text("Nenhuma instância ativa", modifier = Modifier.align(Alignment.Center))
            } else {
                LazyColumn(modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
                    item {
                        ThresholdEditor(
                            client = client,
                            serverId = null,
                            onUpdate = { globalPreference = it },
                        )
                        HorizontalDivider(modifier = Modifier.padding(vertical = 16.dp))
                        Text("Servidores", style = MaterialTheme.typography.titleMedium)
                    }
                    if (servers.isEmpty() && isLoadingServers) {
                        item { CircularProgressIndicator(modifier = Modifier.padding(vertical = 16.dp)) }
                    } else if (servers.isEmpty()) {
                        item {
                            Text(
                                "Nenhum servidor",
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(vertical = 12.dp),
                            )
                        }
                    } else {
                        items(servers, key = { it.id }) { server ->
                            Column(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable {
                                        expandedServerId = if (expandedServerId == server.id) null else server.id
                                    }
                                    .padding(vertical = 12.dp),
                            ) {
                                Text(server.name, style = MaterialTheme.typography.bodyLarge)
                                if (expandedServerId == server.id) {
                                    ThresholdEditor(
                                        client = client,
                                        serverId = server.id,
                                        globalDefault = globalPreference,
                                    )
                                }
                            }
                            HorizontalDivider()
                        }
                    }
                    errorMessage?.let { message ->
                        item {
                            Column(
                                modifier = Modifier.padding(vertical = 16.dp),
                                verticalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                Text(message, color = MaterialTheme.colorScheme.error)
                                Button(onClick = { scope.launch { loadServers() } }) { Text("Tentar de novo") }
                            }
                        }
                    }
                }
            }
        }
    }
}
