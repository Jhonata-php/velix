package com.velix.app.features.dashboard

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
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
import com.velix.app.core.ApiException
import com.velix.app.core.LocalAppSession
import com.velix.app.core.ServerSummary
import kotlinx.coroutines.launch

/** Tela principal do dashboard: lista de servidores via `GET /servers`.
 * Espelha o `DashboardView` do app iOS — mesmos quatro estados (carregando só
 * na primeira vez, erro com retry, vazio, populado) e pull-to-refresh. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DashboardScreen(onServerClick: (ServerSummary) -> Unit) {
    val session = LocalAppSession.current
    val client = session.activeApiClient

    var servers by remember { mutableStateOf<List<ServerSummary>>(emptyList()) }
    var isLoading by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var hasLoadedOnce by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    suspend fun load() {
        if (client == null) return
        isLoading = true
        errorMessage = null
        try {
            servers = client.get("/servers")
        } catch (e: ApiException) {
            errorMessage = e.message ?: "Erro ao carregar servidores"
        } finally {
            isLoading = false
            hasLoadedOnce = true
        }
    }

    LaunchedEffect(client) { load() }

    Column(modifier = Modifier.fillMaxSize()) {
        Text(
            "Servidores",
            style = MaterialTheme.typography.headlineSmall,
            modifier = Modifier.padding(24.dp),
        )
        Box(modifier = Modifier.weight(1f).fillMaxSize()) {
            when {
                client == null -> Text("Nenhuma instância ativa", modifier = Modifier.align(Alignment.Center))
                isLoading && !hasLoadedOnce -> CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
                errorMessage != null -> Column(
                    modifier = Modifier.align(Alignment.Center).padding(24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Text("Erro ao carregar", style = MaterialTheme.typography.titleMedium)
                    Text(errorMessage!!, color = MaterialTheme.colorScheme.error)
                    Button(onClick = { scope.launch { load() } }) { Text("Tentar de novo") }
                }
                else -> PullToRefreshBox(
                    isRefreshing = isLoading,
                    onRefresh = { scope.launch { load() } },
                    modifier = Modifier.fillMaxSize(),
                ) {
                    if (servers.isEmpty()) {
                        Text("Nenhum servidor", modifier = Modifier.align(Alignment.Center))
                    } else {
                        LazyColumn(modifier = Modifier.fillMaxSize()) {
                            items(servers, key = { it.id }) { server ->
                                ServerRow(server = server, onClick = { onServerClick(server) })
                                HorizontalDivider()
                            }
                        }
                    }
                }
            }
        }
    }
}
