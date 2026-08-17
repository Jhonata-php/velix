package com.velix.app.features.serverdetail

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
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
import com.velix.app.core.ApiException
import com.velix.app.core.LocalAppSession
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable

@Serializable
private data class UpdateEnvBody(val env: Map<String, String>)

private data class EnvRow(val key: String, val value: String)

/**
 * Editor de variáveis de ambiente de uma implantação vinda de repositório —
 * GET/PATCH .../deployments/:id/env (GitDeployService.updateEnv). Salvar
 * recompõe o compose e recria o container no servidor — mesma operação que
 * o painel web faz, só que direto do app.
 */
@Composable
fun EnvironmentEditorScreen(projectId: String, deploymentId: String) {
    val session = LocalAppSession.current
    val client = session.activeApiClient
    val scope = rememberCoroutineScope()

    var rows by remember { mutableStateOf<List<EnvRow>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    var isSaving by remember { mutableStateOf(false) }
    var saved by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    suspend fun load() {
        if (client == null) return
        isLoading = true
        try {
            val env = client.get<Map<String, String>>("/applications/$projectId/deployments/$deploymentId/env")
            rows = env.toSortedMap().map { (k, v) -> EnvRow(k, v) }
        } catch (e: ApiException) {
            errorMessage = e.message ?: "Erro ao carregar variáveis"
        } finally {
            isLoading = false
        }
    }

    fun save() {
        if (client == null) return
        scope.launch {
            isSaving = true
            errorMessage = null
            saved = false
            try {
                val env = rows.mapNotNull { row ->
                    val key = row.key.trim()
                    if (key.isEmpty()) null else key to row.value
                }.toMap()
                client.patch<Unit>("/applications/$projectId/deployments/$deploymentId/env", UpdateEnvBody(env))
                saved = true
            } catch (e: ApiException) {
                errorMessage = e.message ?: "Falha ao salvar"
            } finally {
                isSaving = false
            }
        }
    }

    fun updateRow(index: Int, key: String = rows[index].key, value: String = rows[index].value) {
        rows = rows.toMutableList().also { it[index] = EnvRow(key, value) }
    }

    LaunchedEffect(client, deploymentId) { load() }

    Box(modifier = Modifier.fillMaxSize()) {
        if (isLoading) {
            CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
        } else {
            LazyColumn(modifier = Modifier.fillMaxSize().padding(16.dp)) {
                itemsIndexed(rows) { index, row ->
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            OutlinedTextField(
                                value = row.key,
                                onValueChange = { updateRow(index, key = it) },
                                label = { Text("Chave") },
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth(),
                            )
                            OutlinedTextField(
                                value = row.value,
                                onValueChange = { updateRow(index, value = it) },
                                label = { Text("Valor") },
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
                            )
                        }
                        IconButton(onClick = { rows = rows.toMutableList().also { it.removeAt(index) } }) {
                            Icon(Icons.Filled.Delete, contentDescription = "Remover variável")
                        }
                    }
                }

                item {
                    OutlinedButton(onClick = { rows = rows + EnvRow("", "") }) {
                        Icon(Icons.Filled.Add, contentDescription = null, modifier = Modifier.padding(end = 4.dp))
                        Text("Adicionar variável")
                    }
                }

                errorMessage?.let {
                    item { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 12.dp)) }
                }
                if (saved) {
                    item {
                        Text(
                            "Salvo — o container está sendo recriado.",
                            color = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.padding(top = 12.dp),
                        )
                    }
                }

                item {
                    Button(
                        onClick = ::save,
                        enabled = !isSaving,
                        modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
                    ) {
                        Text(if (isSaving) "Salvando..." else "Salvar")
                    }
                }
            }
        }
    }
}
