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
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.Info
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Surface
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
import androidx.compose.ui.graphics.Color
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
import com.velix.app.core.LocalAppSession
import com.velix.app.core.MetricSample
import com.velix.app.core.ProjectSummary
import com.velix.app.core.ServerSummary
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private enum class DetailTab(val label: String) {
    OVERVIEW("Visão geral"),
    PROJECTS("Projetos"),
}

/**
 * Tela de detalhe do servidor: status atual (CPU/memória/disco), histórico de
 * CPU (gráfico Vico) e os projetos implantados nesse servidor — trocado de
 * "lista de containers" pra "lista de projetos" porque é o nível que faz
 * sentido pra quem administra pelo app, não o container por baixo. Duas abas
 * embaixo (NavigationBar nativo) em vez de tudo empilhado numa tela só.
 */
@Composable
fun ServerDetailScreen(serverId: String, onProjectClick: (ProjectSummary) -> Unit) {
    val session = LocalAppSession.current
    val client = session.activeApiClient
    val context = LocalContext.current

    var server by remember { mutableStateOf<ServerSummary?>(null) }
    var metrics by remember { mutableStateOf<List<MetricSample>>(emptyList()) }
    var projects by remember { mutableStateOf<List<ProjectSummary>>(emptyList()) }
    var isLoading by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var hasLoadedOnce by remember { mutableStateOf(false) }
    var tab by remember { mutableStateOf(DetailTab.OVERVIEW) }
    val scope = rememberCoroutineScope()

    suspend fun load() {
        if (client == null) return
        isLoading = true
        errorMessage = null
        try {
            coroutineScope {
                val serverDeferred = async { client.get<ServerSummary>("/servers/$serverId") }
                val metricsDeferred = async { client.get<List<MetricSample>>("/servers/$serverId/metrics/history?hours=24") }
                val projectsDeferred = async { client.get<List<ProjectSummary>>("/servers/$serverId/applications") }
                server = serverDeferred.await()
                metrics = metricsDeferred.await()
                projects = projectsDeferred.await()
            }
        } catch (e: ApiException) {
            errorMessage = e.message ?: "Erro ao carregar detalhes do servidor"
        } finally {
            isLoading = false
            hasLoadedOnce = true
        }
    }

    LaunchedEffect(client, serverId) { load() }

    fun openInBrowser() {
        val instance = session.instanceStore.activeInstance.value
        if (instance != null) {
            val url = "${instance.baseUrl.trimEnd('/')}/servers/$serverId"
            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
        }
    }

    Column(modifier = Modifier.fillMaxSize()) {
        Box(modifier = Modifier.weight(1f)) {
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
                tab == DetailTab.OVERVIEW -> OverviewContent(
                    server = server,
                    metrics = metrics,
                    onOpenInBrowser = ::openInBrowser,
                )
                else -> ProjectsContent(projects = projects, onProjectClick = onProjectClick)
            }
        }

        NavigationBar {
            NavigationBarItem(
                selected = tab == DetailTab.OVERVIEW,
                onClick = { tab = DetailTab.OVERVIEW },
                icon = { Icon(Icons.Filled.Info, contentDescription = null) },
                label = { Text(DetailTab.OVERVIEW.label) },
            )
            NavigationBarItem(
                selected = tab == DetailTab.PROJECTS,
                onClick = { tab = DetailTab.PROJECTS },
                icon = { Icon(Icons.AutoMirrored.Filled.List, contentDescription = null) },
                label = { Text(DetailTab.PROJECTS.label) },
            )
        }
    }
}

@Composable
private fun OverviewContent(server: ServerSummary?, metrics: List<MetricSample>, onOpenInBrowser: () -> Unit) {
    LazyColumn(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        item { Text("Status", style = MaterialTheme.typography.titleMedium) }
        item { StatsRow(server = server, modifier = Modifier.padding(vertical = 12.dp)) }

        item { Text("CPU (últimas 24h)", style = MaterialTheme.typography.titleMedium) }
        item { CpuHistoryChart(metrics = metrics, modifier = Modifier.padding(vertical = 12.dp)) }

        item {
            Button(onClick = onOpenInBrowser, modifier = Modifier.padding(bottom = 16.dp)) {
                Text("Abrir no navegador")
            }
        }
    }
}

@Composable
private fun StatsRow(server: ServerSummary?, modifier: Modifier = Modifier) {
    val cpu = server?.metrics?.cpuPercent?.let { "${it.toInt()}%" } ?: "—"
    val mem = server?.metrics?.let { m ->
        val used = m.memUsedMb
        val total = m.memTotalMb
        if (used != null && total != null && total > 0) "${(used.toDouble() / total * 100).toInt()}%" else null
    } ?: "—"
    val disk = server?.metrics?.diskPercent ?: "—"

    Row(modifier = modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        StatCard(label = "CPU", value = cpu, modifier = Modifier.weight(1f))
        StatCard(label = "Memória", value = mem, modifier = Modifier.weight(1f))
        StatCard(label = "Disco", value = disk, modifier = Modifier.weight(1f))
    }
}

@Composable
private fun StatCard(label: String, value: String, modifier: Modifier = Modifier) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surfaceVariant,
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Text(label.uppercase(), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(value, style = MaterialTheme.typography.titleLarge)
        }
    }
}

@Composable
private fun ProjectsContent(projects: List<ProjectSummary>, onProjectClick: (ProjectSummary) -> Unit) {
    if (projects.isEmpty()) {
        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text("Nenhum projeto implantado neste servidor.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        return
    }
    LazyColumn(modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
        items(projects, key = { it.id }) { project ->
            ProjectRow(project = project, onClick = { onProjectClick(project) })
            HorizontalDivider()
        }
    }
}

// ponytail: clique abre o servidor no navegador (mesma válvula de escape já
// usada em Overview) — o app é de monitoramento, não gestão de projeto; se
// precisar de tela de detalhe do projeto no app, entra depois.
@Composable
private fun ProjectRow(project: ProjectSummary, onClick: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick).padding(vertical = 12.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(project.name, style = MaterialTheme.typography.bodyLarge)
            project.domains.firstOrNull()?.let {
                Text(it.hostname, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        StatusChip(project.status)
    }
}

// Não-private: reaproveitado em ProjectDetailScreen também.
fun statusColor(status: String): Color = when (status) {
    "RUNNING" -> Color(0xFF22C55E)
    "ERROR" -> Color(0xFFEF4444)
    "DEPLOYING" -> Color(0xFFF97316)
    else -> Color(0xFF9CA3AF)
}

fun statusLabel(status: String): String = when (status) {
    "RUNNING" -> "Rodando"
    "ERROR" -> "Erro"
    "DEPLOYING" -> "Implantando"
    "STOPPED" -> "Parado"
    "REMOVING" -> "Removendo"
    else -> "Vazio"
}

@Composable
fun StatusChip(status: String) {
    val color = statusColor(status)
    Surface(shape = RoundedCornerShape(50), color = color.copy(alpha = 0.15f)) {
        Text(
            statusLabel(status),
            style = MaterialTheme.typography.labelSmall,
            color = color,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
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
