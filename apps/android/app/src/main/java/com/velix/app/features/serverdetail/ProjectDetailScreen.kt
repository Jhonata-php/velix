package com.velix.app.features.serverdetail

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.velix.app.core.ApiException
import com.velix.app.core.LocalAppSession
import com.velix.app.core.ProjectSummary
import kotlinx.coroutines.launch

/**
 * Detalhe de um projeto — status, domínios e as três ações de ciclo de vida
 * (POST /applications/:id/start|stop|restart). Tocar num domínio abre ele no
 * navegador do sistema (a única "válvula de escape" que sobra); o resto fica
 * no app, sem redirecionar pra tela web pra gerenciar o projeto.
 */
@Composable
fun ProjectDetailScreen(projectId: String, onEditEnv: (deploymentId: String) -> Unit) {
    val session = LocalAppSession.current
    val client = session.activeApiClient
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var project by remember { mutableStateOf<ProjectSummary?>(null) }
    var isLoading by remember { mutableStateOf(false) }
    var isBusy by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    suspend fun load() {
        if (client == null) return
        isLoading = true
        try {
            project = client.get("/applications/$projectId")
        } catch (e: ApiException) {
            errorMessage = e.message ?: "Erro ao carregar projeto"
        } finally {
            isLoading = false
        }
    }

    LaunchedEffect(client, projectId) { load() }

    fun runAction(action: String) {
        if (client == null) return
        scope.launch {
            isBusy = true
            errorMessage = null
            try {
                client.post<Unit>("/applications/$projectId/$action")
                load()
            } catch (e: ApiException) {
                errorMessage = e.message ?: "Falha ao executar ação"
            } finally {
                isBusy = false
            }
        }
    }

    Box(modifier = Modifier.fillMaxSize()) {
        when {
            client == null -> Text("Nenhuma instância ativa", modifier = Modifier.align(Alignment.Center))
            isLoading && project == null -> CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
            project == null -> Column(
                modifier = Modifier.align(Alignment.Center).padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text("Erro ao carregar", style = MaterialTheme.typography.titleMedium)
                errorMessage?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                Button(onClick = { scope.launch { load() } }) { Text("Tentar de novo") }
            }
            else -> ProjectDetailContent(
                project = project!!,
                isBusy = isBusy,
                errorMessage = errorMessage,
                onStart = { runAction("start") },
                onRestart = { runAction("restart") },
                onStop = { runAction("stop") },
                onOpenDomain = { hostname ->
                    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://$hostname")))
                },
                onEditEnv = project!!.deployments.firstOrNull { it.sourceType == "git" }?.id?.let { id -> { onEditEnv(id) } },
            )
        }
    }
}

@Composable
private fun ProjectDetailContent(
    project: ProjectSummary,
    isBusy: Boolean,
    errorMessage: String?,
    onStart: () -> Unit,
    onRestart: () -> Unit,
    onStop: () -> Unit,
    onOpenDomain: (String) -> Unit,
    onEditEnv: (() -> Unit)?,
) {
    LazyColumn(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        item { Text(project.name, style = MaterialTheme.typography.headlineSmall) }
        item {
            Row(modifier = Modifier.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                StatusChip(project.status)
            }
        }

        if (project.domains.isNotEmpty()) {
            item {
                Text("Domínios", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 12.dp, bottom = 4.dp))
            }
            items(project.domains, key = { it.hostname }) { domain ->
                Text(
                    domain.hostname,
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { onOpenDomain(domain.hostname) }
                        .padding(vertical = 10.dp),
                )
                HorizontalDivider()
            }
        }

        item {
            Row(
                modifier = Modifier.fillMaxWidth().padding(top = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Button(onClick = onStart, enabled = !isBusy) {
                    Icon(Icons.Filled.PlayArrow, contentDescription = null, modifier = Modifier.padding(end = 4.dp))
                    Text("Iniciar")
                }
                OutlinedButton(onClick = onRestart, enabled = !isBusy) {
                    Icon(Icons.Filled.Refresh, contentDescription = null, modifier = Modifier.padding(end = 4.dp))
                    Text("Reiniciar")
                }
                OutlinedButton(
                    onClick = onStop,
                    enabled = !isBusy,
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
                ) {
                    Text("Parar")
                }
            }
        }

        onEditEnv?.let { edit ->
            item {
                OutlinedButton(onClick = edit, modifier = Modifier.padding(top = 12.dp)) {
                    Text("Variáveis de ambiente")
                }
            }
        }

        errorMessage?.let {
            item {
                Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 12.dp))
            }
        }
    }
}
