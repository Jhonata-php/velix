package com.velix.app.features.notifications

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.velix.app.core.AlertThresholdPreference
import com.velix.app.core.ApiClient
import com.velix.app.core.ApiException
import com.velix.app.core.ThresholdUpdateBody
import kotlinx.coroutines.launch

/**
 * Editor de limites de alerta reusado tanto pro padrão global (`serverId ==
 * null`) quanto pro override de um servidor específico — o único ponto que
 * muda entre os dois contextos é qual endpoint é chamado (`path`), a UI é
 * idêntica. Espelha o `ThresholdEditorView` do app iOS.
 */
@Composable
fun ThresholdEditor(
    client: ApiClient,
    serverId: String?,
    globalDefault: AlertThresholdPreference? = null,
    onUpdate: (AlertThresholdPreference?) -> Unit = {},
) {
    val path = if (serverId != null) "/servers/$serverId/alerts/thresholds" else "/alerts/thresholds"
    val scope = rememberCoroutineScope()

    var isLoading by remember { mutableStateOf(true) }
    var isSaving by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    var cpuEnabled by remember { mutableStateOf(false) }
    var cpuValue by remember { mutableIntStateOf(80) }
    var memoryEnabled by remember { mutableStateOf(false) }
    var memoryValue by remember { mutableIntStateOf(80) }
    var temperatureEnabled by remember { mutableStateOf(false) }
    var temperatureValue by remember { mutableIntStateOf(70) }
    var dockerEnabled by remember { mutableStateOf(false) }
    var dockerScope by remember { mutableStateOf("all") }

    fun apply(preference: AlertThresholdPreference?) {
        cpuEnabled = preference?.cpuPercent != null
        cpuValue = preference?.cpuPercent ?: 80
        memoryEnabled = preference?.memoryPercent != null
        memoryValue = preference?.memoryPercent ?: 80
        temperatureEnabled = preference?.temperatureCelsius != null
        temperatureValue = preference?.temperatureCelsius ?: 70
        dockerEnabled = preference?.dockerEnabled ?: false
        dockerScope = preference?.dockerScope ?: "all"
    }

    suspend fun load() {
        isLoading = true
        errorMessage = null
        try {
            val preference = client.get<AlertThresholdPreference?>(path)
            apply(preference)
            onUpdate(preference)
        } catch (e: ApiException) {
            errorMessage = e.message ?: "Erro ao carregar limites"
        } finally {
            isLoading = false
        }
    }

    suspend fun submit(body: ThresholdUpdateBody) {
        isSaving = true
        errorMessage = null
        try {
            val updated = client.put<AlertThresholdPreference>(path, body)
            apply(updated)
            onUpdate(updated)
        } catch (e: ApiException) {
            errorMessage = e.message ?: "Erro ao salvar limites"
        } finally {
            isSaving = false
        }
    }

    LaunchedEffect(client, path) { load() }

    Column(modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
        Text("Limites de alerta", style = MaterialTheme.typography.titleMedium)
        if (isLoading) {
            CircularProgressIndicator(modifier = Modifier.padding(vertical = 12.dp))
        } else {
            thresholdRow("CPU", "%", 1..100, cpuEnabled, cpuValue, { cpuEnabled = it }, { cpuValue = it })
            thresholdRow(
                "Memória", "%", 1..100, memoryEnabled, memoryValue,
                { memoryEnabled = it }, { memoryValue = it },
            )
            thresholdRow(
                "Temperatura", "°C", 0..120, temperatureEnabled, temperatureValue,
                { temperatureEnabled = it }, { temperatureValue = it },
            )

            Text(
                "Containers",
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(top = 16.dp),
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                Switch(checked = dockerEnabled, onCheckedChange = { dockerEnabled = it })
                Text("Alertar sobre containers")
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                RadioButton(
                    selected = dockerScope == "all",
                    onClick = { dockerScope = "all" },
                    enabled = dockerEnabled,
                )
                Text("Todos os containers")
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                RadioButton(
                    selected = dockerScope == "managed_apps",
                    onClick = { dockerScope = "managed_apps" },
                    enabled = dockerEnabled,
                )
                Text("Só minhas aplicações")
            }
        }

        errorMessage?.let {
            Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 8.dp))
        }

        Row(
            modifier = Modifier.padding(top = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Button(
                enabled = !isSaving && !isLoading,
                onClick = {
                    scope.launch {
                        submit(
                            ThresholdUpdateBody(
                                cpuPercent = if (cpuEnabled) cpuValue else null,
                                memoryPercent = if (memoryEnabled) memoryValue else null,
                                temperatureCelsius = if (temperatureEnabled) temperatureValue else null,
                                dockerScope = dockerScope,
                                dockerEnabled = dockerEnabled,
                            ),
                        )
                    }
                },
            ) {
                if (isSaving) CircularProgressIndicator(modifier = Modifier.padding(2.dp)) else Text("Salvar")
            }

            // "Usar o padrão": não existe endpoint pra limpar um override e
            // voltar a herdar o global (ver task-8-brief.md) — a única forma
            // de "resetar" hoje é copiar os valores globais atuais pro
            // override deste servidor via PUT. Isso cria uma linha de
            // override real igual ao global, não uma herança viva: mudanças
            // futuras no padrão global não se propagam sozinhas pra cá.
            if (serverId != null) {
                OutlinedButton(
                    enabled = !isSaving && !isLoading && globalDefault != null,
                    onClick = {
                        val default = globalDefault ?: return@OutlinedButton
                        scope.launch {
                            submit(
                                ThresholdUpdateBody(
                                    cpuPercent = default.cpuPercent,
                                    memoryPercent = default.memoryPercent,
                                    temperatureCelsius = default.temperatureCelsius,
                                    dockerScope = default.dockerScope,
                                    dockerEnabled = default.dockerEnabled,
                                ),
                            )
                        }
                    },
                ) {
                    Text("Usar o padrão")
                }
            }
        }
    }
}

@Composable
private fun thresholdRow(
    label: String,
    unit: String,
    range: IntRange,
    enabled: Boolean,
    value: Int,
    onEnabledChange: (Boolean) -> Unit,
    onValueChange: (Int) -> Unit,
) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Switch(checked = enabled, onCheckedChange = onEnabledChange)
        Text(label, modifier = Modifier.padding(start = 4.dp))
        if (enabled) {
            Row(
                modifier = Modifier.padding(start = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = { if (value - 1 >= range.first) onValueChange(value - 1) }) {
                    Text("−")
                }
                Text("$value$unit")
                IconButton(onClick = { if (value + 1 <= range.last) onValueChange(value + 1) }) {
                    Text("+")
                }
            }
        }
    }
}
