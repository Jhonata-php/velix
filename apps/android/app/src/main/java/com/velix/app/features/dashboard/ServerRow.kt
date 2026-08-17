package com.velix.app.features.dashboard

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.velix.app.core.ServerMetrics
import com.velix.app.core.ServerSummary
import kotlin.math.roundToInt

/** Uma linha da lista do dashboard: indicador de status + nome + métricas
 * (quando presentes). Espelha o `ServerRow` do app iOS — mesma lógica de
 * cores e de formatação de CPU/mem/temperatura. */
@Composable
fun ServerRow(server: ServerSummary, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 24.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Box(
            modifier = Modifier
                .size(38.dp)
                .background(color = statusColor(server.status).copy(alpha = 0.15f), shape = CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                server.name.take(1).uppercase(),
                style = MaterialTheme.typography.titleMedium,
                color = statusColor(server.status),
            )
        }
        Column(modifier = Modifier.weight(1f)) {
            Text(server.name, style = MaterialTheme.typography.bodyLarge)
            metricsText(server.metrics)?.let {
                Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Box(
            modifier = Modifier
                .size(8.dp)
                .background(color = statusColor(server.status), shape = CircleShape),
        )
    }
}

private fun statusColor(status: String): Color = when (status) {
    "ONLINE" -> Color(0xFF4CAF50)
    "ERROR" -> Color(0xFFF44336)
    else -> Color(0xFF9E9E9E) // OFFLINE, PENDING, e qualquer status desconhecido
}

/** Junta CPU/mem/temperatura num texto único, omitindo qualquer campo `null`
 * (nunca mostra "N/A" ou 0 falso). `null` se `metrics` for `null` ou não
 * sobrar nenhum campo pra mostrar. */
private fun metricsText(metrics: ServerMetrics?): String? {
    if (metrics == null) return null
    val parts = mutableListOf<String>()
    metrics.cpuPercent?.let { parts += "CPU ${it.roundToInt()}%" }
    val usedMb = metrics.memUsedMb
    val totalMb = metrics.memTotalMb
    if (usedMb != null && totalMb != null && totalMb > 0) {
        val memPercent = (usedMb.toDouble() / totalMb * 100).roundToInt()
        parts += "Mem $memPercent%"
    }
    metrics.temperatureCelsius?.let { parts += "${it.roundToInt()}°C" }
    return parts.takeIf { it.isNotEmpty() }?.joinToString(" · ")
}
