# Android Fase 1 — Reiniciar servidor + aba Containers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Portar pro app Android o botão de reiniciar servidor e a aba "Containers" (listar, iniciar/parar, remover, ver logs) que o app iOS já tem, reaproveitando os mesmos endpoints.

**Architecture:** Extensão do `ServerDetailScreen.kt` existente (3ª aba na `NavigationBar` local) + um novo arquivo `ContainersScreen.kt` no pacote `features/serverdetail`, seguindo exatamente o padrão já usado por `ProjectsContent`/`ProjectDetailScreen` (estado hoisted no composable de topo, `ApiClient` via `LocalAppSession`, `ApiException` pro erro).

**Tech Stack:** Kotlin, Jetpack Compose, Material 3, Ktor client (já existente), `kotlinx.serialization`.

## Global Constraints

- Nenhuma decisão de contrato de API nova — todo endpoint usado aqui já está em produção servindo o app iOS (ver `docs/superpowers/specs/2026-08-20-android-management-parity-design.md`, seção 2).
- Sem framework de DI novo — estado e `ApiClient` continuam vindo de `LocalAppSession` (`AppSession`), mesmo padrão de todo o app.
- TDD só faz sentido pra lógica pura (parsing/serialização de modelo) — telas Compose são verificadas por build + rodar no emulador `Pixel_8` + captura de screenshot, mesmo padrão usado na construção original do app (`docs/superpowers/specs/2026-08-15-android-app-design.md`, seção 7). Não escrever teste de UI instrumentado (Espresso/Compose UI Test) — fora do escopo já decidido.
- `material-icons-extended` é adicionado nesta fase (Task 3) porque o ícone da aba Containers não existe no set core, e as fases 2/4 do roadmap também vão precisar de ícones fora do core (Domínios, Terminal, Bancos) — uma dependência oficial do AndroidX, não uma escolha nova de terceiro.

---

## Task 1: Modelos de Docker (status, container, logs) + testes

**Files:**
- Modify: `apps/android/app/src/main/java/com/velix/app/core/Models.kt`
- Test: `apps/android/app/src/test/java/com/velix/app/core/ApiClientTest.kt`

**Interfaces:**
- Produces: `ServerActionResponse(ok: Boolean, message: String)`, `DockerStatusResponse(installed: Boolean, version: String?, containers: List<DockerContainerInfo>?)`, `DockerContainerInfo(id: String, image: String, status: String, names: String)` com propriedade computada `isRunning: Boolean`, `ContainerLogsResponse(logs: String)` — todos usados pelas Tasks 2-3.

- [ ] **Step 1: Escrever os testes que ainda não compilam (classes não existem)**

Adicionar ao final da classe `ApiClientTest` em `apps/android/app/src/test/java/com/velix/app/core/ApiClientTest.kt` (antes do `}` de fechamento da classe):

```kotlin
    @Test
    fun decodesDockerStatusWhenNotInstalled() {
        val decoded = json.decodeFromString<DockerStatusResponse>("""{"installed":false}""")
        assertFalse(decoded.installed)
        assertNull(decoded.containers)
    }

    @Test
    fun decodesDockerStatusWithContainersAndDetectsRunning() {
        val decoded = json.decodeFromString<DockerStatusResponse>(
            """{"installed":true,"version":"24.0.7","containers":[
               {"id":"abc123","image":"postgres:16.4","status":"Up 3 hours","names":"meuapp_db"},
               {"id":"def456","image":"redis:7","status":"Exited (0) 2 days ago","names":"meuapp_cache"}
            ]}"""
        )
        assertEquals(2, decoded.containers?.size)
        assertTrue(decoded.containers!![0].isRunning)
        assertFalse(decoded.containers!![1].isRunning)
    }

    @Test
    fun decodesContainerLogs() {
        val decoded = json.decodeFromString<ContainerLogsResponse>("""{"logs":"linha 1\nlinha 2"}""")
        assertEquals("linha 1\nlinha 2", decoded.logs)
    }

    @Test
    fun decodesServerActionResponse() {
        val decoded = json.decodeFromString<ServerActionResponse>("""{"ok":true,"message":"Comando enviado"}""")
        assertTrue(decoded.ok)
        assertEquals("Comando enviado", decoded.message)
    }
```

- [ ] **Step 2: Rodar os testes pra confirmar que falham (não compila)**

Run: `cd apps/android && ./gradlew testDebugUnitTest --tests "com.velix.app.core.ApiClientTest"`
Expected: FAIL — erro de compilação, `DockerStatusResponse`/`DockerContainerInfo`/`ContainerLogsResponse`/`ServerActionResponse` não existem em `com.velix.app.core`.

- [ ] **Step 3: Implementar os modelos**

Adicionar ao final de `apps/android/app/src/main/java/com/velix/app/core/Models.kt`:

```kotlin
/** Resposta de POST /servers/:id/reboot — `message` explica o resultado. */
@Serializable
data class ServerActionResponse(val ok: Boolean, val message: String)

// GET /servers/:id/docker/status — sem version/containers quando installed=false.
@Serializable
data class DockerStatusResponse(
    val installed: Boolean,
    val version: String? = null,
    val containers: List<DockerContainerInfo>? = null,
)

// `status` é a saída bruta de `docker ps` (ex.: "Up 3 hours", "Exited (0) 2
// days ago") — não um enum fechado, mesmo formato que o painel web e o iOS usam.
@Serializable
data class DockerContainerInfo(
    val id: String,
    val image: String,
    val status: String,
    val names: String,
) {
    val isRunning: Boolean get() = status.lowercase().contains("up")
}

// GET /servers/:id/docker/containers/:id/logs?tail=300
@Serializable
data class ContainerLogsResponse(val logs: String)
```

- [ ] **Step 4: Rodar os testes de novo pra confirmar que passam**

Run: `cd apps/android && ./gradlew testDebugUnitTest --tests "com.velix.app.core.ApiClientTest"`
Expected: PASS — todos os testes da classe, incluindo os 4 novos.

- [ ] **Step 5: Commit**

```bash
git add apps/android/app/src/main/java/com/velix/app/core/Models.kt apps/android/app/src/test/java/com/velix/app/core/ApiClientTest.kt
git commit -m "Android: modelos de Docker (status/container/logs) e ação de servidor"
```

---

## Task 2: Botão "Reiniciar servidor" na aba Visão geral

**Files:**
- Modify: `apps/android/app/src/main/java/com/velix/app/features/serverdetail/ServerDetailScreen.kt`

**Interfaces:**
- Consumes: `ServerActionResponse` (Task 1), `ApiClient.post<T>(path: String): T` (já existe em `ApiClient.kt`), `ApiException` (já existe).
- Produces: nenhuma interface nova consumida por outras tasks — self-contained.

- [ ] **Step 1: Adicionar imports novos no topo do arquivo**

Em `apps/android/app/src/main/java/com/velix/app/features/serverdetail/ServerDetailScreen.kt`, adicionar junto aos imports existentes de `androidx.compose.material3.*`:

```kotlin
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.TextButton
```

E junto ao import já existente `com.velix.app.core.ServerSummary`, adicionar:

```kotlin
import com.velix.app.core.ServerActionResponse
```

- [ ] **Step 2: Adicionar estado de reboot no composable `ServerDetailScreen`**

Logo abaixo da linha `var tab by remember { mutableStateOf(DetailTab.OVERVIEW) }` (dentro de `fun ServerDetailScreen`), adicionar:

```kotlin
    var isRebooting by remember { mutableStateOf(false) }
    var showRebootConfirm by remember { mutableStateOf(false) }
    var rebootMessage by remember { mutableStateOf<String?>(null) }
```

- [ ] **Step 3: Adicionar a função `reboot()` logo depois de `load()`**

Depois do fechamento da função `suspend fun load() { ... }` (mesmo escopo, dentro de `ServerDetailScreen`):

```kotlin
    suspend fun reboot() {
        if (client == null) return
        isRebooting = true
        rebootMessage = null
        try {
            val response: ServerActionResponse = client.post("/servers/$serverId/reboot")
            rebootMessage = response.message
        } catch (e: ApiException) {
            rebootMessage = e.message ?: "Falha ao reiniciar servidor"
        } finally {
            isRebooting = false
        }
    }
```

- [ ] **Step 4: Passar os novos parâmetros pra `OverviewContent` na chamada existente**

Localizar (dentro do `Box` de `ServerDetailScreen`):

```kotlin
                tab == DetailTab.OVERVIEW -> OverviewContent(
                    server = server,
                    metrics = metrics,
                    onOpenInBrowser = ::openInBrowser,
                )
```

Substituir por:

```kotlin
                tab == DetailTab.OVERVIEW -> OverviewContent(
                    server = server,
                    metrics = metrics,
                    onOpenInBrowser = ::openInBrowser,
                    isRebooting = isRebooting,
                    rebootMessage = rebootMessage,
                    onRebootClick = { showRebootConfirm = true },
                )
```

- [ ] **Step 5: Adicionar o diálogo de confirmação logo depois do `Column { ... }` de `ServerDetailScreen`**

Localizar o fechamento do bloco `Column(modifier = Modifier.fillMaxSize()) { ... }` dentro de `ServerDetailScreen` (contém o `Box` e o `NavigationBar`). Logo depois desse `Column { ... }` fechar, mas ainda dentro da função `ServerDetailScreen`, adicionar:

```kotlin

    if (showRebootConfirm) {
        AlertDialog(
            onDismissRequest = { showRebootConfirm = false },
            title = { Text("Reiniciar este servidor agora?") },
            text = { Text("O servidor fica indisponível por alguns minutos até voltar.") },
            confirmButton = {
                TextButton(onClick = {
                    showRebootConfirm = false
                    scope.launch { reboot() }
                }) { Text("Reiniciar") }
            },
            dismissButton = {
                TextButton(onClick = { showRebootConfirm = false }) { Text("Cancelar") }
            },
        )
    }
```

- [ ] **Step 6: Atualizar a assinatura e o corpo de `OverviewContent`**

Substituir a função `OverviewContent` inteira:

```kotlin
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
```

por:

```kotlin
@Composable
private fun OverviewContent(
    server: ServerSummary?,
    metrics: List<MetricSample>,
    onOpenInBrowser: () -> Unit,
    isRebooting: Boolean,
    rebootMessage: String?,
    onRebootClick: () -> Unit,
) {
    LazyColumn(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        item { Text("Status", style = MaterialTheme.typography.titleMedium) }
        item { StatsRow(server = server, modifier = Modifier.padding(vertical = 12.dp)) }

        item { Text("CPU (últimas 24h)", style = MaterialTheme.typography.titleMedium) }
        item { CpuHistoryChart(metrics = metrics, modifier = Modifier.padding(vertical = 12.dp)) }

        item {
            Button(onClick = onOpenInBrowser, modifier = Modifier.padding(top = 8.dp)) {
                Text("Abrir no navegador")
            }
        }

        item {
            OutlinedButton(
                onClick = onRebootClick,
                enabled = !isRebooting,
                colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
                modifier = Modifier.padding(top = 12.dp, bottom = 16.dp),
            ) {
                Text(if (isRebooting) "Reiniciando…" else "Reiniciar servidor")
            }
        }

        rebootMessage?.let { message ->
            item {
                Text(message, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(bottom = 16.dp))
            }
        }
    }
}
```

- [ ] **Step 7: Build e verificação visual no emulador**

Run: `cd apps/android && ./gradlew assembleDebug`
Expected: BUILD SUCCESSFUL.

Instalar e abrir no emulador `Pixel_8` (já configurado), navegar até o detalhe de um servidor (aba Visão geral), tocar em "Reiniciar servidor", confirmar no diálogo, e capturar screenshot mostrando a mensagem de resultado abaixo do botão.

- [ ] **Step 8: Commit**

```bash
git add apps/android/app/src/main/java/com/velix/app/features/serverdetail/ServerDetailScreen.kt
git commit -m "Android: botão de reiniciar servidor na aba Visão geral"
```

---

## Task 3: Aba "Containers" — listar, iniciar/parar, remover, ver logs

**Files:**
- Modify: `apps/android/app/build.gradle.kts`
- Modify: `apps/android/gradle/libs.versions.toml`
- Modify: `apps/android/app/src/main/java/com/velix/app/features/serverdetail/ServerDetailScreen.kt`
- Create: `apps/android/app/src/main/java/com/velix/app/features/serverdetail/ContainersScreen.kt`

**Interfaces:**
- Consumes: `DockerStatusResponse`, `DockerContainerInfo`, `ContainerLogsResponse` (Task 1); `statusColor(status: String): Color` (já existe, não-`private`, mesmo pacote, definida em `ServerDetailScreen.kt`).
- Produces: `@Composable fun ContainersContent(serverId: String)` — consumida pelo `when` de `ServerDetailScreen` (Step 5 abaixo).

- [ ] **Step 1: Adicionar `material-icons-extended` ao catálogo de versões**

Em `apps/android/gradle/libs.versions.toml`, na seção `[libraries]`, logo abaixo da linha `androidx-material3 = { ... }`, adicionar:

```toml
androidx-material-icons-extended = { group = "androidx.compose.material", name = "material-icons-extended" }
```

- [ ] **Step 2: Adicionar a dependência no módulo**

Em `apps/android/app/build.gradle.kts`, no bloco `dependencies { ... }`, logo abaixo de `implementation(libs.androidx.material3)`, adicionar:

```kotlin
    implementation(libs.androidx.material.icons.extended)
```

- [ ] **Step 3: Adicionar a 3ª aba ao enum `DetailTab`**

Em `ServerDetailScreen.kt`, substituir:

```kotlin
private enum class DetailTab(val label: String) {
    OVERVIEW("Visão geral"),
    PROJECTS("Projetos"),
}
```

por:

```kotlin
private enum class DetailTab(val label: String) {
    OVERVIEW("Visão geral"),
    PROJECTS("Projetos"),
    CONTAINERS("Containers"),
}
```

- [ ] **Step 4: Adicionar o 3º item na `NavigationBar` local**

Localizar o bloco `NavigationBar { ... }` no final de `ServerDetailScreen` (contém os dois `NavigationBarItem` de Overview/Projects). Adicionar, logo depois do segundo `NavigationBarItem` (Projetos) e antes do `}` que fecha `NavigationBar`:

```kotlin
            NavigationBarItem(
                selected = tab == DetailTab.CONTAINERS,
                onClick = { tab = DetailTab.CONTAINERS },
                icon = { Icon(Icons.Filled.Inventory2, contentDescription = null) },
                label = { Text(DetailTab.CONTAINERS.label) },
            )
```

E adicionar o import correspondente junto aos outros `androidx.compose.material.icons.filled.*`:

```kotlin
import androidx.compose.material.icons.filled.Inventory2
```

- [ ] **Step 5: Trocar o `when` de conteúdo de 2 pra 3 ramos explícitos**

Localizar (dentro do `Box` de `ServerDetailScreen`, já modificado na Task 2):

```kotlin
                tab == DetailTab.OVERVIEW -> OverviewContent(
                    server = server,
                    metrics = metrics,
                    onOpenInBrowser = ::openInBrowser,
                    isRebooting = isRebooting,
                    rebootMessage = rebootMessage,
                    onRebootClick = { showRebootConfirm = true },
                )
                else -> ProjectsContent(projects = projects, onProjectClick = onProjectClick)
```

Substituir por:

```kotlin
                tab == DetailTab.OVERVIEW -> OverviewContent(
                    server = server,
                    metrics = metrics,
                    onOpenInBrowser = ::openInBrowser,
                    isRebooting = isRebooting,
                    rebootMessage = rebootMessage,
                    onRebootClick = { showRebootConfirm = true },
                )
                tab == DetailTab.PROJECTS -> ProjectsContent(projects = projects, onProjectClick = onProjectClick)
                else -> ContainersContent(serverId = serverId)
```

- [ ] **Step 6: Criar `ContainersScreen.kt`**

Criar `apps/android/app/src/main/java/com/velix/app/features/serverdetail/ContainersScreen.kt`:

```kotlin
package com.velix.app.features.serverdetail

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.velix.app.core.ApiException
import com.velix.app.core.ContainerLogsResponse
import com.velix.app.core.DockerContainerInfo
import com.velix.app.core.DockerStatusResponse
import com.velix.app.core.LocalAppSession
import kotlinx.coroutines.launch

/**
 * Aba "Containers" do detalhe do servidor — lista com iniciar/parar, remover
 * e ver logs. Mesmos endpoints que a aba Docker do painel web e o app iOS
 * usam (`GET .../docker/status`, `.../start`, `.../stop`, `DELETE ...`).
 */
@Composable
fun ContainersContent(serverId: String) {
    val session = LocalAppSession.current
    val client = session.activeApiClient
    val scope = rememberCoroutineScope()

    var containers by remember { mutableStateOf<List<DockerContainerInfo>>(emptyList()) }
    var dockerInstalled by remember { mutableStateOf(true) }
    var isLoading by remember { mutableStateOf(false) }
    var hasLoadedOnce by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var actioningId by remember { mutableStateOf<String?>(null) }
    var confirmRemove by remember { mutableStateOf<DockerContainerInfo?>(null) }
    var logsTarget by remember { mutableStateOf<DockerContainerInfo?>(null) }

    suspend fun load() {
        if (client == null) return
        isLoading = true
        errorMessage = null
        try {
            val status: DockerStatusResponse = client.get("/servers/$serverId/docker/status")
            dockerInstalled = status.installed
            containers = status.containers ?: emptyList()
        } catch (e: ApiException) {
            errorMessage = e.message ?: "Erro ao carregar containers"
        } finally {
            isLoading = false
            hasLoadedOnce = true
        }
    }

    LaunchedEffect(client, serverId) { load() }

    fun toggle(container: DockerContainerInfo) {
        if (client == null) return
        scope.launch {
            actioningId = container.id
            try {
                val action = if (container.isRunning) "stop" else "start"
                client.post<Unit>("/servers/$serverId/docker/containers/${container.id}/$action")
                load()
            } catch (e: ApiException) {
                errorMessage = e.message ?: "Falha ao executar ação"
            } finally {
                actioningId = null
            }
        }
    }

    fun remove(container: DockerContainerInfo) {
        if (client == null) return
        scope.launch {
            actioningId = container.id
            try {
                client.delete("/servers/$serverId/docker/containers/${container.id}")
                load()
            } catch (e: ApiException) {
                errorMessage = e.message ?: "Falha ao remover"
            } finally {
                actioningId = null
                confirmRemove = null
            }
        }
    }

    Box(modifier = Modifier.fillMaxSize()) {
        when {
            !dockerInstalled && hasLoadedOnce -> Text(
                "Instale o Docker neste servidor pelo painel web antes de gerenciar containers por aqui.",
                modifier = Modifier.align(Alignment.Center).padding(24.dp),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            isLoading && !hasLoadedOnce -> CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
            errorMessage != null && containers.isEmpty() -> Column(
                modifier = Modifier.align(Alignment.Center).padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text("Erro ao carregar", style = MaterialTheme.typography.titleMedium)
                Text(errorMessage!!, color = MaterialTheme.colorScheme.error)
                TextButton(onClick = { scope.launch { load() } }) { Text("Tentar de novo") }
            }
            containers.isEmpty() -> Text(
                "Nenhum container",
                modifier = Modifier.align(Alignment.Center),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            else -> LazyColumn(modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
                items(containers, key = { it.id }) { container ->
                    ContainerRow(
                        container = container,
                        busy = actioningId == container.id,
                        onToggle = { toggle(container) },
                        onLogs = { logsTarget = container },
                        onRemove = { confirmRemove = container },
                    )
                    HorizontalDivider()
                }
            }
        }
    }

    confirmRemove?.let { target ->
        AlertDialog(
            onDismissRequest = { confirmRemove = null },
            title = { Text("Remover container?") },
            text = {
                Text(
                    "O container \"${target.names}\" é removido — se ele tinha dado num volume nomeado, " +
                        "o volume continua existindo. Não dá pra desfazer."
                )
            },
            confirmButton = { TextButton(onClick = { remove(target) }) { Text("Remover") } },
            dismissButton = { TextButton(onClick = { confirmRemove = null }) { Text("Cancelar") } },
        )
    }

    logsTarget?.let { target ->
        ContainerLogsDialog(serverId = serverId, container = target, onClose = { logsTarget = null })
    }
}

@Composable
private fun ContainerRow(
    container: DockerContainerInfo,
    busy: Boolean,
    onToggle: () -> Unit,
    onLogs: () -> Unit,
    onRemove: () -> Unit,
) {
    var menuExpanded by remember { mutableStateOf(false) }

    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            modifier = Modifier
                .size(8.dp)
                .clip(CircleShape)
                .background(statusColor(if (container.isRunning) "RUNNING" else "STOPPED")),
        )

        Column(modifier = Modifier.weight(1f)) {
            Text(container.names, style = MaterialTheme.typography.bodyLarge, maxLines = 1)
            Text(
                container.image,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
            )
        }

        if (busy) {
            CircularProgressIndicator(modifier = Modifier.size(20.dp))
        } else {
            Box {
                IconButton(onClick = { menuExpanded = true }) {
                    Icon(Icons.Filled.MoreVert, contentDescription = "Ações")
                }
                DropdownMenu(expanded = menuExpanded, onDismissRequest = { menuExpanded = false }) {
                    DropdownMenuItem(
                        text = { Text(if (container.isRunning) "Parar" else "Iniciar") },
                        leadingIcon = {
                            Icon(
                                if (container.isRunning) Icons.Filled.Stop else Icons.Filled.PlayArrow,
                                contentDescription = null,
                            )
                        },
                        onClick = { menuExpanded = false; onToggle() },
                    )
                    DropdownMenuItem(
                        text = { Text("Ver logs") },
                        leadingIcon = { Icon(Icons.Filled.Description, contentDescription = null) },
                        onClick = { menuExpanded = false; onLogs() },
                    )
                    DropdownMenuItem(
                        text = { Text("Remover", color = MaterialTheme.colorScheme.error) },
                        leadingIcon = {
                            Icon(Icons.Filled.Delete, contentDescription = null, tint = MaterialTheme.colorScheme.error)
                        },
                        onClick = { menuExpanded = false; onRemove() },
                    )
                }
            }
        }
    }
}

@Composable
private fun ContainerLogsDialog(serverId: String, container: DockerContainerInfo, onClose: () -> Unit) {
    val session = LocalAppSession.current
    val client = session.activeApiClient
    val scope = rememberCoroutineScope()

    var logs by remember { mutableStateOf("") }
    var isLoading by remember { mutableStateOf(true) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    suspend fun load() {
        if (client == null) return
        isLoading = true
        errorMessage = null
        try {
            val response: ContainerLogsResponse = client.get("/servers/$serverId/docker/containers/${container.id}/logs?tail=300")
            logs = response.logs
        } catch (e: ApiException) {
            errorMessage = e.message ?: "Erro ao carregar logs"
        } finally {
            isLoading = false
        }
    }

    LaunchedEffect(container.id) { load() }

    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(modifier = Modifier.fillMaxSize(), color = Color.Black) {
            Column(modifier = Modifier.fillMaxSize()) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(12.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    TextButton(onClick = onClose) { Text("Fechar", color = Color.White) }
                    Text(container.names, color = Color.White, style = MaterialTheme.typography.titleSmall)
                    IconButton(onClick = { scope.launch { load() } }, enabled = !isLoading) {
                        Icon(Icons.Filled.Refresh, contentDescription = "Atualizar", tint = Color.White)
                    }
                }
                Box(modifier = Modifier.fillMaxSize().padding(12.dp)) {
                    when {
                        isLoading && logs.isEmpty() ->
                            CircularProgressIndicator(modifier = Modifier.align(Alignment.Center), color = Color.White)
                        errorMessage != null && logs.isEmpty() ->
                            Text(errorMessage!!, color = Color.White.copy(alpha = 0.7f))
                        else -> Text(
                            logs.ifEmpty { "(sem saída)" },
                            color = Color.White,
                            fontFamily = FontFamily.Monospace,
                            fontSize = 11.sp,
                            modifier = Modifier.verticalScroll(rememberScrollState()),
                        )
                    }
                }
            }
        }
    }
}
```

- [ ] **Step 7: Build**

Run: `cd apps/android && ./gradlew assembleDebug`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 8: Verificação visual no emulador**

Instalar e abrir no emulador `Pixel_8`. Navegar: Dashboard → um servidor → aba "Containers". Confirmar:
- Lista de containers aparece com bolinha verde/cinza, nome, imagem em fonte menor.
- Tocar no menu (⋮) de um container, tocar "Ver logs" → abre tela preta em tela cheia com log monoespaçado, botão "Fechar" e ícone de atualizar funcionando.
- Tocar "Parar"/"Iniciar" num container muda o estado (bolinha muda de cor após recarregar).
- Tocar "Remover" mostra o diálogo de confirmação antes de remover de fato.

Capturar screenshot da aba Containers com pelo menos um container listado, e da tela de logs aberta, como evidência.

- [ ] **Step 9: Rodar a suíte de testes JVM completa (garantir que nada quebrou)**

Run: `cd apps/android && ./gradlew testDebugUnitTest`
Expected: BUILD SUCCESSFUL, todos os testes (incluindo os 4 novos da Task 1) passando.

- [ ] **Step 10: Commit**

```bash
git add apps/android/gradle/libs.versions.toml apps/android/app/build.gradle.kts apps/android/app/src/main/java/com/velix/app/features/serverdetail/ServerDetailScreen.kt apps/android/app/src/main/java/com/velix/app/features/serverdetail/ContainersScreen.kt
git commit -m "Android: aba Containers — listar, iniciar/parar, remover, ver logs"
```
