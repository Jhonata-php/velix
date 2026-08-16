package com.velix.app.features.serverdetail

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.patrykandpatrick.vico.compose.cartesian.CartesianChartHost
import com.patrykandpatrick.vico.compose.cartesian.axis.rememberBottom
import com.patrykandpatrick.vico.compose.cartesian.axis.rememberStart
import com.patrykandpatrick.vico.compose.cartesian.layer.rememberLineCartesianLayer
import com.patrykandpatrick.vico.compose.cartesian.rememberCartesianChart
import com.patrykandpatrick.vico.compose.common.ProvideVicoTheme
import com.patrykandpatrick.vico.compose.m3.common.rememberM3VicoTheme
import com.patrykandpatrick.vico.core.cartesian.axis.HorizontalAxis
import com.patrykandpatrick.vico.core.cartesian.axis.VerticalAxis
import com.patrykandpatrick.vico.core.cartesian.data.CartesianChartModelProducer
import com.patrykandpatrick.vico.core.cartesian.data.CartesianValueFormatter
import com.patrykandpatrick.vico.core.cartesian.data.lineSeries
import com.velix.app.core.ApiException
import com.velix.app.core.ContainerStatus
import com.velix.app.core.DockerStatusResponse
import com.velix.app.core.LocalAppSession
import com.velix.app.core.MetricSample
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * Tela de detalhe do servidor: histórico de CPU (gráfico Vico), status do
 * Docker e atalho pra abrir o servidor no navegador. Busca
 * `/metrics/history` e `/docker/status` em paralelo (coroutineScope +
 * async), mesmo espírito do `ServerDetailView` do app iOS.
 */
@Composable
fun ServerDetailScreen(serverId: String) {
    val session = LocalAppSession.current
    val client = session.activeApiClient
    val context = LocalContext.current

    var metrics by remember { mutableStateOf<List<MetricSample>>(emptyList()) }
    var dockerStatus by remember { mutableStateOf<DockerStatusResponse?>(null) }
    var isLoading by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var hasLoadedOnce by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    suspend fun load() {
        if (client == null) return
        isLoading = true
        errorMessage = null
        try {
            coroutineScope {
                val metricsDeferred =
                    async { client.get<List<MetricSample>>("/servers/$serverId/metrics/history?hours=24") }
                val dockerDeferred =
                    async { client.get<DockerStatusResponse>("/servers/$serverId/docker/status") }
                metrics = metricsDeferred.await()
                dockerStatus = dockerDeferred.await()
            }
        } catch (e: ApiException) {
            errorMessage = e.message ?: "Erro ao carregar detalhes do servidor"
        } finally {
            isLoading = false
            hasLoadedOnce = true
        }
    }

    LaunchedEffect(client, serverId) { load() }

    Box(modifier = Modifier.fillMaxSize()) {
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
            else -> ServerDetailContent(
                metrics = metrics,
                dockerStatus = dockerStatus,
                onOpenInBrowser = {
                    // ponytail: lê o valor atual direto do StateFlow (sem collectAsState) —
                    // é um clique único, não precisa recompor a UI quando a instância muda.
                    val instance = session.instanceStore.activeInstance.value
                    if (instance != null) {
                        val url = "${instance.baseUrl.trimEnd('/')}/servers/$serverId"
                        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                    }
                },
            )
        }
    }
}

@Composable
private fun ServerDetailContent(
    metrics: List<MetricSample>,
    dockerStatus: DockerStatusResponse?,
    onOpenInBrowser: () -> Unit,
) {
    val containers = dockerStatus?.containers ?: emptyList()

    LazyColumn(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        item { Text("CPU (últimas 24h)", style = MaterialTheme.typography.titleMedium) }
        item { CpuHistoryChart(metrics = metrics, modifier = Modifier.padding(vertical = 12.dp)) }
        item {
            Button(onClick = onOpenInBrowser, modifier = Modifier.padding(bottom = 16.dp)) {
                Text("Abrir no navegador")
            }
        }
        item {
            Text("Docker", style = MaterialTheme.typography.titleMedium)
            HorizontalDivider(modifier = Modifier.padding(top = 8.dp, bottom = 8.dp))
        }
        when {
            dockerStatus == null || !dockerStatus.installed -> item {
                Text("Docker não instalado", modifier = Modifier.padding(vertical = 8.dp))
            }
            containers.isEmpty() -> item {
                Text("Docker instalado — nenhum container em execução", modifier = Modifier.padding(vertical = 8.dp))
            }
            else -> items(containers, key = { it.id }) { container ->
                ContainerRow(container)
                HorizontalDivider()
            }
        }
    }
}

@Composable
private fun ContainerRow(container: ContainerStatus) {
    Column(modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
        Text(container.names, style = MaterialTheme.typography.bodyLarge)
        Text(container.image, style = MaterialTheme.typography.bodySmall)
        Text(
            container.status,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.secondary,
        )
    }
}

private data class CpuPoint(val index: Int, val cpuPercent: Double, val timeLabel: String)

/** ISO8601 -> Instant. Retorna null (em vez de travar) se a data não parsear. */
private fun parseCapturedAt(raw: String): Instant? =
    try {
        Instant.parse(raw)
    } catch (e: Exception) {
        null
    }

/**
 * Gráfico de linha (Vico) de CPU% ao longo do tempo. Amostras com
 * `cpuPercent` nulo são ignoradas (não viram zero no gráfico); datas que não
 * parseiam viram só um rótulo vazio no eixo X em vez de travar a tela.
 */
@Composable
private fun CpuHistoryChart(metrics: List<MetricSample>, modifier: Modifier = Modifier) {
    val points = remember(metrics) {
        metrics.mapNotNull { sample ->
            val cpu = sample.cpuPercent ?: return@mapNotNull null
            val label = parseCapturedAt(sample.capturedAt)
                ?.let { DateTimeFormatter.ofPattern("HH:mm").withZone(ZoneId.systemDefault()).format(it) }
                ?: ""
            cpu to label
        }.mapIndexed { index, (cpu, label) -> CpuPoint(index, cpu, label) }
    }

    if (points.isEmpty()) {
        Text("Sem amostras de CPU nesse período", modifier = modifier)
        return
    }

    val modelProducer = remember { CartesianChartModelProducer() }
    LaunchedEffect(points) {
        modelProducer.runTransaction {
            lineSeries { series(x = points.map { it.index }, y = points.map { it.cpuPercent }) }
        }
    }

    val labelFormatter = remember(points) {
        CartesianValueFormatter { _, value, _ ->
            points.getOrNull(value.toInt())?.timeLabel?.takeIf { it.isNotEmpty() } ?: value.toInt().toString()
        }
    }

    ProvideVicoTheme(rememberM3VicoTheme()) {
        CartesianChartHost(
            chart = rememberCartesianChart(
                rememberLineCartesianLayer(),
                startAxis = VerticalAxis.rememberStart(),
                bottomAxis = HorizontalAxis.rememberBottom(valueFormatter = labelFormatter),
            ),
            modelProducer = modelProducer,
            modifier = modifier.fillMaxWidth().height(220.dp),
        )
    }
}
