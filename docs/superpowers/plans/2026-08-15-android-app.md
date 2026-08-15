# App Android nativo — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development pra executar tarefa por tarefa. Verificação visual final (emulador) é feita pelo controlador da sessão.

**Goal:** app Android nativo (Kotlin/Compose, minSdk 26) com as seis telas da spec de UX, rodando de verdade no emulador `Pixel_8` já configurado nesta máquina.

**Architecture:** Compose + `CompositionLocal` pro estado global, Ktor Client + kotlinx.serialization pra rede, `EncryptedSharedPreferences` pro token, Firebase Cloud Messaging pro push. Ver `docs/superpowers/specs/2026-08-15-android-app-design.md` pra decisões técnicas (inclui 3 lições tiradas do app iOS já aplicadas de antemão) e `docs/superpowers/specs/2026-08-15-mobile-app-product-ux-design.md` pra fluxo/telas.

**Tech Stack:** Kotlin, Jetpack Compose, Material 3, Ktor Client, kotlinx.serialization, Compose Navigation, Vico (gráfico), Firebase SDK.

## Nota sobre este plano

Mesmo espírito do plano do app iOS: tasks de UI (Compose) especificam o contrato funcional exato, não o código-fonte completo — verificadas rodando no emulador, não lendo o texto do plano. As camadas que não são UI (modelos, cliente de API, armazenamento seguro) têm código completo, porque um erro sutil ali se propaga silenciosamente por todas as telas que dependem delas.

## Global Constraints

- `applicationId`: `com.velix.app`. Nome do app: "Velix".
- `minSdk 26`, `compileSdk`/`targetSdk 35`.
- Comentários no código, quando necessários, em português.
- Base URL da API vem de `Instance.baseUrl` (por instância) — nunca hardcoded.
- Toda chamada autenticada usa `Authorization: Bearer <token>`.
- **Contrato do Docker**: `GET /servers/:id/docker/status` → `{ installed: Boolean, version: String?, containers: List<ContainerStatus>? }` — objeto, não lista solta. (Confirmado durante o app iOS, ver spec Android seção 2.)
- **2FA vem como erro 401**, não como campo de uma resposta 200 — `{ message, reason: "totp_required" | "totp_invalid" }` no corpo do erro. A detecção tem que ficar no tratamento de exceção da chamada de login, nunca no caminho de sucesso. (Idem, ver spec Android seção 2.)
- **Campo de limite desabilitado precisa serializar como `null` explícito**, nunca ficar ausente do JSON — checar que nenhum `Json { }` builder usado nas chamadas de PUT de limite tem `explicitNulls = false`.
- Emulador usado em toda verificação: AVD `Pixel_8` (já criado nesta máquina). `ANDROID_HOME=/Users/jhonata/Library/Android/sdk`. `JAVA_HOME` do Gradle deve apontar pro JDK do Android Studio (`/Applications/Android Studio.app/Contents/jbr/Contents/Home`) — o Java do sistema é 1.8, incompatível com o Android Gradle Plugin atual.

---

### Task 1: Projeto Gradle + estrutura de pacotes

**Files:**
- Create: `apps/android/settings.gradle.kts`
- Create: `apps/android/build.gradle.kts` (raiz)
- Create: `apps/android/gradle/libs.versions.toml` (catálogo de versões)
- Create: `apps/android/app/build.gradle.kts`
- Create: `apps/android/app/src/main/AndroidManifest.xml`
- Create: `apps/android/app/src/main/java/com/velix/app/VelixApplication.kt`
- Create: `apps/android/app/src/main/java/com/velix/app/MainActivity.kt`
- Create: `apps/android/app/src/main/res/values/strings.xml`, `themes.xml`
- Create: `apps/android/gradlew`, `gradlew.bat`, `gradle/wrapper/*` (via `gradle wrapper`, usando o Gradle do Android Studio)

**Interfaces:**
- Produces: um projeto Android que builda vazio (`./gradlew assembleDebug` verde) e instala/abre no emulador mostrando uma tela em branco — todas as tasks seguintes assumem que este esqueleto já existe e builda.

- [ ] **Step 1: Gerar o wrapper do Gradle**

O Gradle do sistema não está instalado (`which gradle` vazio) e o Android Studio traz sua própria JDK. Usar a JDK do Android Studio pra rodar o Gradle:

```bash
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
cd apps/android
"$JAVA_HOME/bin/java" -version   # confirma JDK 21
```

Se não houver um `gradle` executável disponível em lugar nenhum pra gerar o wrapper inicial, baixar a distribuição do Gradle uma vez via `curl`/`unzip` (versão 8.9, compatível com AGP 8.x) só pra rodar `gradle wrapper --gradle-version 8.9`, que gera `gradlew`/`gradlew.bat`/`gradle/wrapper/gradle-wrapper.properties` — depois disso, todo o resto do plano usa exclusivamente `./gradlew`, nunca um `gradle` de sistema.

- [ ] **Step 2: `settings.gradle.kts`**

```kotlin
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "Velix"
include(":app")
```

- [ ] **Step 3: `build.gradle.kts` (raiz)**

```kotlin
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.kotlin.serialization) apply false
}
```

- [ ] **Step 4: `gradle/libs.versions.toml`**

```toml
[versions]
agp = "8.7.2"
kotlin = "2.0.21"
coreKtx = "1.15.0"
composeBom = "2024.12.01"
activityCompose = "1.9.3"
lifecycleRuntimeKtx = "2.8.7"
navigationCompose = "2.8.5"

[libraries]
androidx-core-ktx = { group = "androidx.core", name = "core-ktx", version.ref = "coreKtx" }
androidx-lifecycle-runtime-ktx = { group = "androidx.lifecycle", name = "lifecycle-runtime-ktx", version.ref = "lifecycleRuntimeKtx" }
androidx-activity-compose = { group = "androidx.activity", name = "activity-compose", version.ref = "activityCompose" }
androidx-compose-bom = { group = "androidx.compose", name = "compose-bom", version.ref = "composeBom" }
androidx-ui = { group = "androidx.compose.ui", name = "ui" }
androidx-ui-graphics = { group = "androidx.compose.ui", name = "ui-graphics" }
androidx-ui-tooling-preview = { group = "androidx.compose.ui", name = "ui-tooling-preview" }
androidx-material3 = { group = "androidx.compose.material3", name = "material3" }
androidx-navigation-compose = { group = "androidx.navigation", name = "navigation-compose", version.ref = "navigationCompose" }

[plugins]
android-application = { id = "com.android.application", version.ref = "agp" }
kotlin-android = { id = "org.jetbrains.kotlin.android", version.ref = "kotlin" }
kotlin-compose = { id = "org.jetbrains.kotlin.plugin.compose", version.ref = "kotlin" }
kotlin-serialization = { id = "org.jetbrains.kotlin.plugin.serialization", version.ref = "kotlin" }
```

- [ ] **Step 5: `app/build.gradle.kts`**

```kotlin
plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "com.velix.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.velix.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
    }

    buildFeatures {
        compose = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.ui)
    implementation(libs.androidx.ui.graphics)
    implementation(libs.androidx.ui.tooling.preview)
    implementation(libs.androidx.material3)
    implementation(libs.androidx.navigation.compose)
}
```

- [ ] **Step 6: `AndroidManifest.xml`**

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.INTERNET" />
    <application
        android:label="Velix"
        android:theme="@style/Theme.Velix">
        <activity
            android:name=".MainActivity"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
```

- [ ] **Step 7: `VelixApplication.kt` e `MainActivity.kt` mínimos**

```kotlin
package com.velix.app

import android.app.Application

class VelixApplication : Application()
```

```kotlin
package com.velix.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.Text

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            Text("Velix")
        }
    }
}
```

(`VelixApplication` precisa ser referenciada em `AndroidManifest.xml` via `android:name=".VelixApplication"` no elemento `<application>` — adicionar isso ao manifest do Step 6.)

- [ ] **Step 8: `themes.xml`/`strings.xml` mínimos**

```xml
<!-- res/values/themes.xml -->
<resources>
    <style name="Theme.Velix" parent="android:Theme.Material.Light.NoActionBar" />
</resources>
```
```xml
<!-- res/values/strings.xml -->
<resources>
    <string name="app_name">Velix</string>
</resources>
```

- [ ] **Step 9: Build**

```bash
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
cd apps/android && ./gradlew assembleDebug
```
Expected: `BUILD SUCCESSFUL`

- [ ] **Step 10: Instalar e abrir no emulador**

```bash
export ANDROID_HOME="/Users/jhonata/Library/Android/sdk"
"$ANDROID_HOME/emulator/emulator" -avd Pixel_8 -no-snapshot-load &
# esperar o boot (adb wait-for-device + checar sys.boot_completed)
"$ANDROID_HOME/platform-tools/adb" wait-for-device
"$ANDROID_HOME/platform-tools/adb" shell 'while [[ -z $(getprop sys.boot_completed) ]]; do sleep 2; done'
"$ANDROID_HOME/platform-tools/adb" install -r apps/android/app/build/outputs/apk/debug/app-debug.apk
"$ANDROID_HOME/platform-tools/adb" shell am start -n com.velix.app/.MainActivity
```
Expected: instala e abre sem crash (confirmar via `adb shell dumpsys activity activities | grep velix` ou simplesmente `adb logcat` sem stack trace de crash logo após o `am start`).

- [ ] **Step 11: Commit**

```bash
git add apps/android
git commit -m "App Android: esqueleto do projeto Gradle (builda e abre vazio)"
```

---

### Task 2: Modelos (DTOs) + cliente de API

**Files:**
- Create: `apps/android/app/src/main/java/com/velix/app/core/Models.kt`
- Create: `apps/android/app/src/main/java/com/velix/app/core/ApiClient.kt`
- Create: `apps/android/app/build.gradle.kts` (adiciona dependências Ktor + kotlinx.serialization)
- Create: `apps/android/app/src/test/java/com/velix/app/core/ApiClientTest.kt`

**Interfaces:**
- Produces: `ApiClient` com `suspend fun get<T>(path): T`, `suspend fun post<T>(path, body): T`, `suspend fun put<T>(path, body): T`, `suspend fun delete(path)`; `ApiException` tipada (mensagem do backend quando disponível, `reason` quando presente — ver Global Constraints sobre 2FA). Todos os DTOs `@Serializable` de `Models.kt` — usados por toda tela.

**Contratos exatos do backend** (mesmos do plano iOS Task 2 — não repetir a investigação, usar diretamente):

```
POST /auth/login
  body: { email, password, totpCode?, rememberMe? }
  200 sucesso: { accessToken, user: { name, email, role } }
  401 com corpo { message, reason: "totp_required" | "totp_invalid" } quando precisa de 2FA — NÃO é uma resposta de sucesso

GET /servers → [{ id, name, status, publicIp?, hostname?, dockerInstalled, metrics: { loadAvg1?, memUsedMb?, memTotalMb?, diskPercent?, cpuPercent?, temperatureCelsius? }? }]

GET /servers/:id/metrics/history?hours=24 → [{ loadAvg1?, memUsedMb?, memTotalMb?, diskPercent?, cpuPercent?, temperatureCelsius?, capturedAt }]

GET /servers/:id/docker/status → { installed: Boolean, version: String?, containers: [{ id, image, status, names }]? }

GET /alerts/thresholds → AlertThresholdPreference?
PUT /alerts/thresholds  body parcial: { cpuPercent?, memoryPercent?, temperatureCelsius?, dockerScope?, dockerEnabled? } → AlertThresholdPreference
GET /servers/:id/alerts/thresholds → AlertThresholdPreference?  (já cai pro global se não houver override)
PUT /servers/:id/alerts/thresholds → AlertThresholdPreference

POST /push/devices  body: { platform: "android", fcmToken } → { ok: true }
DELETE /push/devices/:id → { ok: true }
```

`AlertThresholdPreference`: `{ id, userId, serverId: String?, cpuPercent: Int?, memoryPercent: Int?, temperatureCelsius: Int?, dockerScope: "all" | "managed_apps", dockerEnabled: Boolean }`.

- [ ] **Step 1: Adicionar as dependências Ktor + kotlinx.serialization**

Em `gradle/libs.versions.toml`, adicionar sob `[versions]`: `ktor = "3.0.2"`, `kotlinxSerialization = "1.7.3"`. Sob `[libraries]`: `ktor-client-core`, `ktor-client-okhttp`, `ktor-client-content-negotiation`, `ktor-serialization-kotlinx-json` (todos `group = "io.ktor"`, versão `ktor`), `kotlinx-serialization-json` (`group = "org.jetbrains.kotlinx"`, versão `kotlinxSerialization`). Sob `[plugins]`, já existe `kotlin-serialization` — aplicar em `app/build.gradle.kts`: `alias(libs.plugins.kotlin.serialization)`. Adicionar as libs em `dependencies { }`.

- [ ] **Step 2: Escrever o teste primeiro**

`apps/android/app/src/test/java/com/velix/app/core/ApiClientTest.kt`:

```kotlin
package com.velix.app.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.encodeToString
import org.junit.Test
import org.junit.Assert.*

class ApiClientTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun decodesLoginSuccess() {
        val decoded = json.decodeFromString<LoginResponse>(
            """{"accessToken":"abc123","user":{"name":"Ana","email":"ana@x.com","role":"admin"}}"""
        )
        assertEquals("abc123", decoded.accessToken)
        assertEquals("ana@x.com", decoded.user?.email)
    }

    @Test
    fun decodesServerSummaryWithMissingMetrics() {
        val decoded = json.decodeFromString<ServerSummary>(
            """{"id":"s1","name":"srv1","status":"ONLINE","dockerInstalled":true}"""
        )
        assertEquals("s1", decoded.id)
        assertNull(decoded.metrics)
    }

    @Test
    fun decodesErrorBodyWithReason() {
        val decoded = json.decodeFromString<ApiErrorBody>(
            """{"message":"Código de verificação necessário","reason":"totp_required"}"""
        )
        assertEquals("totp_required", decoded.reason)
    }

    @Test
    fun disabledThresholdFieldSerializesAsExplicitNull() {
        // Trava a lição #3 da spec: campo nil precisa aparecer como "null" no
        // JSON, não sumir da chave — kotlinx.serialization já faz isso por
        // padrão (explicitNulls=true é o default), mas este teste garante que
        // nenhuma configuração futura desliga isso sem que o teste quebre.
        val body = ThresholdUpdateBody(cpuPercent = null, memoryPercent = 70, temperatureCelsius = null, dockerScope = "all", dockerEnabled = true)
        val encoded = json.encodeToString(body)
        assertTrue("esperava \"cpuPercent\":null no JSON, veio: $encoded", encoded.contains("\"cpuPercent\":null"))
        assertTrue("esperava \"temperatureCelsius\":null no JSON, veio: $encoded", encoded.contains("\"temperatureCelsius\":null"))
    }
}
```

- [ ] **Step 3: Rodar e confirmar que falha**

```bash
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
cd apps/android && ./gradlew test
```
Expected: falha de compilação (tipos ainda não existem)

- [ ] **Step 4: Implementar `Models.kt`**

```kotlin
package com.velix.app.core

import kotlinx.serialization.Serializable

@Serializable
data class LoginResponse(
    val accessToken: String? = null,
    val user: LoggedUser? = null,
)

@Serializable
data class LoggedUser(val name: String, val email: String, val role: String)

@Serializable
data class ServerMetrics(
    val loadAvg1: Double? = null,
    val memUsedMb: Int? = null,
    val memTotalMb: Int? = null,
    val diskPercent: Double? = null,
    val cpuPercent: Double? = null,
    val temperatureCelsius: Double? = null,
)

@Serializable
data class ServerSummary(
    val id: String,
    val name: String,
    val status: String,
    val publicIp: String? = null,
    val hostname: String? = null,
    val dockerInstalled: Boolean,
    val metrics: ServerMetrics? = null,
)

@Serializable
data class MetricSample(
    val loadAvg1: Double? = null,
    val memUsedMb: Int? = null,
    val memTotalMb: Int? = null,
    val diskPercent: Double? = null,
    val cpuPercent: Double? = null,
    val temperatureCelsius: Double? = null,
    val capturedAt: String,
)

@Serializable
data class ContainerStatus(val id: String, val image: String, val status: String, val names: String)

@Serializable
data class DockerStatusResponse(
    val installed: Boolean,
    val version: String? = null,
    val containers: List<ContainerStatus>? = null,
)

@Serializable
data class AlertThresholdPreference(
    val id: String? = null,
    val userId: String? = null,
    val serverId: String? = null,
    val cpuPercent: Int? = null,
    val memoryPercent: Int? = null,
    val temperatureCelsius: Int? = null,
    val dockerScope: String = "all",
    val dockerEnabled: Boolean = true,
)

@Serializable
data class ThresholdUpdateBody(
    val cpuPercent: Int? = null,
    val memoryPercent: Int? = null,
    val temperatureCelsius: Int? = null,
    val dockerScope: String? = null,
    val dockerEnabled: Boolean? = null,
)

@Serializable
data class ApiErrorBody(val message: String? = null, val reason: String? = null)

@Serializable
data class LoginRequestBody(
    val email: String,
    val password: String,
    val totpCode: String? = null,
    val rememberMe: Boolean? = null,
)
```

- [ ] **Step 5: Implementar `ApiClient.kt`**

```kotlin
package com.velix.app.core

import io.ktor.client.*
import io.ktor.client.call.*
import io.ktor.client.engine.okhttp.*
import io.ktor.client.plugins.contentnegotiation.*
import io.ktor.client.request.*
import io.ktor.client.statement.*
import io.ktor.http.*
import io.ktor.serialization.kotlinx.json.*
import kotlinx.serialization.json.Json

sealed class ApiException(message: String) : Exception(message) {
    class Http(val status: Int, val serverMessage: String?, val reason: String?) :
        ApiException(serverMessage ?: "Erro ao falar com o servidor")
    class Network(cause: Throwable) : ApiException(cause.message ?: "Sem conexão com o servidor")
    class Decoding(cause: Throwable) : ApiException("Resposta inesperada do servidor")
}

class ApiClient(private val baseUrl: String, private var token: String? = null) {
    private val json = Json { ignoreUnknownKeys = true }

    private val client = HttpClient(OkHttp) {
        install(ContentNegotiation) { json(json) }
    }

    private suspend inline fun <reified T> request(
        path: String,
        method: HttpMethod,
        body: Any? = null,
    ): T {
        val response = try {
            client.request("$baseUrl$path") {
                this.method = method
                token?.let { header(HttpHeaders.Authorization, "Bearer $it") }
                if (body != null) {
                    contentType(ContentType.Application.Json)
                    setBody(body)
                }
            }
        } catch (e: Exception) {
            throw ApiException.Network(e)
        }

        if (!response.status.isSuccess()) {
            val errorBody = try {
                json.decodeFromString<ApiErrorBody>(response.bodyAsText())
            } catch (e: Exception) {
                null
            }
            throw ApiException.Http(response.status.value, errorBody?.message, errorBody?.reason)
        }

        return try {
            response.body()
        } catch (e: Exception) {
            throw ApiException.Decoding(e)
        }
    }

    suspend inline fun <reified T> get(path: String): T = request(path, HttpMethod.Get)
    suspend inline fun <reified T> post(path: String, body: Any): T = request(path, HttpMethod.Post, body)
    suspend inline fun <reified T> put(path: String, body: Any): T = request(path, HttpMethod.Put, body)
    suspend fun delete(path: String) { request<Unit>(path, HttpMethod.Delete) }
}
```

- [ ] **Step 6: Rodar e confirmar que passa**

```bash
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
cd apps/android && ./gradlew test
```
Expected: `BUILD SUCCESSFUL`, os 4 testes passando.

- [ ] **Step 7: Commit**

```bash
git add apps/android
git commit -m "App Android: modelos e cliente de API"
```

---

### Task 3: SecureStore + armazenamento de instâncias

**Files:**
- Create: `apps/android/app/src/main/java/com/velix/app/core/SecureStore.kt`
- Create: `apps/android/app/src/main/java/com/velix/app/core/Instance.kt`
- Create: `apps/android/app/build.gradle.kts` (adiciona `androidx.security:security-crypto`)
- Create: `apps/android/app/src/test/java/com/velix/app/core/InstanceStoreTest.kt`

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: `SecureStore.save(key, value)`/`.read(key)`/`.delete(key)` (String in/out, sobre `EncryptedSharedPreferences`); `Instance` data class (`id: String (UUID)`, `baseUrl: String`, `displayName: String`, `userEmail: String`, `accessToken: String`); `InstanceStore` (`StateFlow<List<Instance>>`, `StateFlow<Instance?>` pra ativa) com `add(Instance)`, `remove(Instance)`, `setActive(Instance)`, persistido via `SecureStore` (serializa a lista como JSON). Consumido por `AppSession` (Task 4) e todas as telas.

**Nota**: `InstanceStoreTest` é um teste JVM puro (`./gradlew test`), mas `EncryptedSharedPreferences` depende do Android Keystore, que só existe de verdade num dispositivo/emulador — **não dá pra testar `SecureStore` como teste JVM puro** (isso seria um teste instrumentado, `./gradlew connectedAndroidTest`, rodando no emulador, fora do escopo de teste rápido deste plano). Pra `InstanceStoreTest` conseguir rodar como teste JVM, `InstanceStore` deve receber uma interface simples (`interface KeyValueStore { fun save(key, value); fun read(key): String?; fun delete(key) }`) que `SecureStore` implementa de verdade e o teste implementa com um `HashMap` em memória — a mesma técnica de "injeta um fake" já usada no `ServerWatcherSsh` do backend.

- [ ] **Step 1: Escrever o teste primeiro**

```kotlin
package com.velix.app.core

import org.junit.Test
import org.junit.Assert.*

class FakeKeyValueStore : KeyValueStore {
    private val map = mutableMapOf<String, String>()
    override fun save(key: String, value: String) { map[key] = value }
    override fun read(key: String): String? = map[key]
    override fun delete(key: String) { map.remove(key) }
}

class InstanceStoreTest {
    private fun newInstance(id: String, url: String) =
        Instance(id = id, baseUrl = url, displayName = url, userEmail = "$id@x.com", accessToken = "tok-$id")

    @Test
    fun addSetsAsActiveWhenFirst() {
        val store = InstanceStore(FakeKeyValueStore())
        val i1 = newInstance("i1", "https://a.com")
        store.add(i1)
        assertEquals(i1.id, store.activeInstance.value?.id)
        assertEquals(1, store.instances.value.size)
    }

    @Test
    fun removeActiveFallsBackToAnother() {
        val store = InstanceStore(FakeKeyValueStore())
        val i1 = newInstance("i1", "https://a.com")
        val i2 = newInstance("i2", "https://b.com")
        store.add(i1); store.add(i2); store.setActive(i1)
        store.remove(i1)
        assertEquals(i2.id, store.activeInstance.value?.id)
    }

    @Test
    fun removeLastLeavesNoActive() {
        val store = InstanceStore(FakeKeyValueStore())
        val i1 = newInstance("i1", "https://a.com")
        store.add(i1); store.remove(i1)
        assertNull(store.activeInstance.value)
        assertTrue(store.instances.value.isEmpty())
    }

    @Test
    fun persistsAcrossFreshInstanceOverSameBackingStore() {
        val backing = FakeKeyValueStore()
        val store1 = InstanceStore(backing)
        store1.add(newInstance("i1", "https://a.com"))

        val store2 = InstanceStore(backing)
        assertEquals(1, store2.instances.value.size)
        assertEquals("i1", store2.activeInstance.value?.id)
    }
}
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
cd apps/android && ./gradlew test
```

- [ ] **Step 3: Adicionar a dependência**

Em `gradle/libs.versions.toml`: `securityCrypto = "1.1.0-alpha06"`, lib `androidx-security-crypto`. Adicionar em `app/build.gradle.kts`.

- [ ] **Step 4: Implementar `SecureStore.kt`**

```kotlin
package com.velix.app.core

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

interface KeyValueStore {
    fun save(key: String, value: String)
    fun read(key: String): String?
    fun delete(key: String)
}

/** Wrapper fino sobre EncryptedSharedPreferences — equivalente Android do
 * Keychain do iOS, biblioteca oficial do Jetpack, sem dependência de terceiro. */
class SecureStore(context: Context) : KeyValueStore {
    private val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()

    private val prefs = EncryptedSharedPreferences.create(
        context,
        "velix_secure_prefs",
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    override fun save(key: String, value: String) {
        prefs.edit().putString(key, value).apply()
    }

    override fun read(key: String): String? = prefs.getString(key, null)

    override fun delete(key: String) {
        prefs.edit().remove(key).apply()
    }
}
```

- [ ] **Step 5: Implementar `Instance.kt`**

```kotlin
package com.velix.app.core

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

@Serializable
data class Instance(
    val id: String,
    val baseUrl: String,
    val displayName: String,
    val userEmail: String,
    val accessToken: String,
)

/** Lista de instâncias Velix logadas — "multi-servidor" no app é
 * multi-instância, não multi-servidor dentro de uma instância só (ver spec de
 * UX, seção 2). */
class InstanceStore(private val store: KeyValueStore) {
    private val json = Json { ignoreUnknownKeys = true }
    private val storageKey = "instances"
    private val activeKey = "active_instance_id"

    private val _instances = MutableStateFlow<List<Instance>>(emptyList())
    val instances: StateFlow<List<Instance>> = _instances.asStateFlow()

    private val _activeInstance = MutableStateFlow<Instance?>(null)
    val activeInstance: StateFlow<Instance?> = _activeInstance.asStateFlow()

    init { load() }

    fun add(instance: Instance) {
        _instances.update { it + instance }
        if (_activeInstance.value == null) _activeInstance.value = instance
        persist()
    }

    fun remove(instance: Instance) {
        _instances.update { list -> list.filterNot { it.id == instance.id } }
        if (_activeInstance.value?.id == instance.id) {
            _activeInstance.value = _instances.value.firstOrNull()
        }
        persist()
    }

    fun setActive(instance: Instance) {
        if (_instances.value.none { it.id == instance.id }) return
        _activeInstance.value = instance
        persist()
    }

    private fun persist() {
        store.save(storageKey, json.encodeToString(_instances.value))
        _activeInstance.value?.let { store.save(activeKey, it.id) } ?: store.delete(activeKey)
    }

    private fun load() {
        val raw = store.read(storageKey) ?: return
        val decoded = try { json.decodeFromString<List<Instance>>(raw) } catch (e: Exception) { return }
        _instances.value = decoded
        val activeId = store.read(activeKey)
        _activeInstance.value = decoded.firstOrNull { it.id == activeId } ?: decoded.firstOrNull()
    }
}
```

- [ ] **Step 6: Rodar e confirmar que passa**

```bash
cd apps/android && ./gradlew test
```
Expected: `BUILD SUCCESSFUL`

- [ ] **Step 7: Commit**

```bash
git add apps/android
git commit -m "App Android: SecureStore e armazenamento de instâncias"
```

---

### Task 4: `AppSession` — estado global e decisão de tela raiz

**Files:**
- Create: `apps/android/app/src/main/java/com/velix/app/core/AppSession.kt`
- Modify: `apps/android/app/src/main/java/com/velix/app/MainActivity.kt`

**Interfaces:**
- Consumes: `InstanceStore`, `SecureStore` (Tasks 2-3).
- Produces: `AppSession` (`apiClient(instance): ApiClient`, `activeApiClient: ApiClient?` computado sobre `instanceStore.activeInstance`), exposto via `CompositionLocal` (`LocalAppSession`). `MainActivity` decide entre o grafo de onboarding e o `NavHost` principal.

- [ ] **Step 1: Implementar `AppSession.kt`**

```kotlin
package com.velix.app.core

import androidx.compose.runtime.compositionLocalOf

class AppSession(val instanceStore: InstanceStore) {
    fun apiClient(instance: Instance): ApiClient = ApiClient(instance.baseUrl, instance.accessToken)

    val activeApiClient: ApiClient?
        get() = instanceStore.activeInstance.value?.let { apiClient(it) }
}

val LocalAppSession = compositionLocalOf<AppSession> { error("AppSession não fornecida") }
```

- [ ] **Step 2: Atualizar `MainActivity.kt`**

```kotlin
package com.velix.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import com.velix.app.core.AppSession
import com.velix.app.core.InstanceStore
import com.velix.app.core.LocalAppSession
import com.velix.app.core.SecureStore

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val session = AppSession(InstanceStore(SecureStore(applicationContext)))

        setContent {
            CompositionLocalProvider(LocalAppSession provides session) {
                val instances by session.instanceStore.instances.collectAsState()
                if (instances.isEmpty()) {
                    // AddInstanceScreen — Task 5
                } else {
                    // MainNavHost (bottom nav) — Task 6+
                }
            }
        }
    }
}
```

(Igual ao plano iOS: este arquivo fica com partes comentadas até as próximas tasks existirem — não é um problema desta task, é construção incremental.)

- [ ] **Step 3: Commit**

```bash
git add apps/android/app/src/main/java/com/velix/app/core/AppSession.kt apps/android/app/src/main/java/com/velix/app/MainActivity.kt
git commit -m "App Android: AppSession e decisão de tela raiz"
```

---

### Task 5: Onboarding — adicionar instância, login, 2FA

**Files:**
- Create: `apps/android/app/src/main/java/com/velix/app/features/onboarding/AddInstanceScreen.kt`
- Create: `apps/android/app/src/main/java/com/velix/app/features/onboarding/LoginScreen.kt`
- Create: `apps/android/app/src/main/java/com/velix/app/features/onboarding/TwoFactorScreen.kt`
- Modify: `apps/android/app/src/main/java/com/velix/app/MainActivity.kt` (liga o `NavHost` de onboarding)

**Interfaces:**
- Consumes: `LocalAppSession`, `ApiClient`/`ApiException` (Task 2).
- Produces: fluxo completo de onboarding, terminando com `session.instanceStore.add(...)`.

**Requisitos funcionais** (ver spec de UX seção 3; ver Global Constraints deste plano sobre o contrato real de 2FA — **crítico**: a detecção de `totp_required`/`totp_invalid` tem que ficar no `catch`/tratamento de `ApiException.Http`, checando `.reason`, nunca no caminho de sucesso de `LoginResponse`, porque o backend manda isso como erro 401):

- `AddInstanceScreen`: campo de texto pro domínio (normaliza adicionando `https://` se ausente), botão "Continuar" desabilitado enquanto vazio. Reachability check: GET simples na base URL, qualquer resposta HTTP (mesmo 404) conta como alcançável, só erro de rede/DNS não conta.
- `LoginScreen`: e-mail/senha, "Lembrar de mim", botão "Entrar". Chama `POST /auth/login`. Sucesso (`accessToken` presente) → monta `Instance`, `instanceStore.add(...)`, chama callback de conclusão (equivalente ao `onFinished` do iOS — usar `NavController.popBackStack(route, inclusive = true)` ou um callback lambda, dependendo de como o `NavHost` for estruturado; escolher o que for mais direto dado que este app não tem o problema de "sheet vs. push" do iOS, mas ainda precisa voltar explicitamente pra tela que iniciou o fluxo). Erro `ApiException.Http` com `.reason` em `"totp_required"`/`"totp_invalid"` → navega pra `TwoFactorScreen`. Qualquer outro erro → mensagem inline.
- `TwoFactorScreen`: campo de 6 dígitos (teclado numérico), link "Usar código de recuperação" (troca pra texto livre). Reenvia login com `totpCode`. Mesma finalização do `LoginScreen` em caso de sucesso.

- [ ] **Step 1: Implementar as três telas conforme os requisitos acima, usando Compose Navigation**

- [ ] **Step 2: Ligar em `MainActivity.kt`** (substitui o comentário `// AddInstanceScreen — Task 5` por um `NavHost` real com as três rotas)

- [ ] **Step 3: Build e instalar no emulador**

```bash
cd apps/android && ./gradlew assembleDebug
"$ANDROID_HOME/platform-tools/adb" install -r app/build/outputs/apk/debug/app-debug.apk
```
Expected: `BUILD SUCCESSFUL`, instala sem erro.

- [ ] **Step 4: Commit**

```bash
git add apps/android
git commit -m "App Android: fluxo de onboarding (adicionar instância, login, 2FA)"
```

---

### Task 6: Dashboard

**Files:**
- Create: `apps/android/app/src/main/java/com/velix/app/features/dashboard/DashboardScreen.kt`
- Create: `apps/android/app/src/main/java/com/velix/app/features/dashboard/ServerRow.kt`
- Create: `apps/android/app/src/main/java/com/velix/app/MainNavHost.kt` (bottom nav com 3 destinos)
- Modify: `apps/android/app/src/main/java/com/velix/app/MainActivity.kt`

**Interfaces:**
- Consumes: `LocalAppSession`, `ServerSummary` (Task 2).
- Produces: `MainNavHost` com `NavigationBar` (Dashboard real; Notificações/Conta placeholders até Tasks 8-9).

**Requisitos funcionais** (mesmo espírito do plano iOS Task 6):
- `DashboardScreen`: lista de `ServerRow` via `GET /servers`, estados de carregando/erro-com-retry/vazio/populado, pull-to-refresh (`PullToRefreshBox`, Material 3).
- `ServerRow`: nome, indicador de status colorido (verde=ONLINE, cinza=OFFLINE/PENDING, vermelho=ERROR), CPU%/memória%/temperatura quando presentes (omitir `null`, não mostrar "N/A"). Tap navega pro detalhe (placeholder até Task 7, criar um mínimo pra não travar a navegação, igual ao plano iOS).

- [ ] **Step 1: Implementar**
- [ ] **Step 2: Build + instalar**
- [ ] **Step 3: Commit**

```bash
git add apps/android
git commit -m "App Android: dashboard de servidores"
```

---

### Task 7: Detalhe do servidor (métricas + gráfico + containers)

**Files:**
- Create: `apps/android/app/src/main/java/com/velix/app/features/serverdetail/ServerDetailScreen.kt`
- Modify: `apps/android/app/build.gradle.kts` (adiciona Vico)

**Interfaces:**
- Consumes: `MetricSample`, `DockerStatusResponse`/`ContainerStatus` (Task 2).

**Requisitos funcionais** (mesmo espírito do plano iOS Task 7):
- Busca `GET /servers/:id/metrics/history?hours=24` e `GET /servers/:id/docker/status` em paralelo (`coroutineScope { async { } }`).
- Gráfico de linha (Vico) de CPU% ao longo do tempo, pulando amostras com `cpuPercent` nulo (não plotar como zero). Parsear `capturedAt` (ISO8601) pro eixo X, pulando datas que não parseiam em vez de travar.
- Três estados de Docker: não instalado / instalado sem containers / instalado com containers — distintos, não colapsados.
- Botão "Abrir no navegador" pra `{baseUrl}/servers/{id}` via `Intent(Intent.ACTION_VIEW)`.

- [ ] **Step 1: Adicionar Vico** (`gradle/libs.versions.toml`: `vico = "2.0.0-beta.3"` ou versão estável mais recente disponível no momento da implementação — checar o Maven Central real antes de fixar; `com.patrykandpatrick.vico:compose`, `com.patrykandpatrick.vico:compose-m3`)
- [ ] **Step 2: Implementar**
- [ ] **Step 3: Build + instalar**
- [ ] **Step 4: Commit**

```bash
git add apps/android
git commit -m "App Android: detalhe do servidor com histórico e containers"
```

---

### Task 8: Configuração de notificações

**Files:**
- Create: `apps/android/app/src/main/java/com/velix/app/features/notifications/NotificationSettingsScreen.kt`
- Create: `apps/android/app/src/main/java/com/velix/app/features/notifications/ThresholdEditor.kt`

**Interfaces:**
- Consumes: `AlertThresholdPreference`, `ThresholdUpdateBody` (Task 2).

**Requisitos funcionais** (mesmo espírito do plano iOS Task 8, **com a mesma limitação de backend documentada lá**: não existe endpoint pra limpar um override por servidor — "usar o padrão" precisa copiar os valores atuais do global pro override via PUT, não inventar um DELETE que não existe):
- `NotificationSettingsScreen`: bloco "Padrão" no topo (`ThresholdEditor` sem `serverId`), lista de servidores abaixo (cada um abre `ThresholdEditor` com `serverId`), botão "Usar o padrão" que copia os valores atuais do global.
- `ThresholdEditor`: composable reusado (contexto muda só o endpoint chamado) — três campos numéricos com toggle habilitado/desabilitado, toggle de container + seletor de escopo, botão "Salvar". **Lembrete crítico**: ao desligar um campo, o `ThresholdUpdateBody` enviado precisa ter esse campo como `null` de verdade no JSON — o teste da Task 2 (`disabledThresholdFieldSerializesAsExplicitNull`) já trava esse comportamento na camada de serialização; esta tela só precisa efetivamente passar `null` no `ThresholdUpdateBody` quando o toggle estiver desligado, não inventar um valor sentinela como `0`.
- Pede permissão de notificação (`POST_NOTIFICATIONS`, obrigatória a partir do Android 13/API 33 — usar `ActivityResultContracts.RequestPermission()`) na primeira vez que esta tela abre.

- [ ] **Step 1: Implementar**
- [ ] **Step 2: Build + instalar**
- [ ] **Step 3: Commit**

```bash
git add apps/android
git commit -m "App Android: configuração de limites de alerta e permissão de notificação"
```

---

### Task 9: Instâncias (trocar/adicionar/remover)

**Files:**
- Create: `apps/android/app/src/main/java/com/velix/app/features/instances/InstanceListScreen.kt`

**Interfaces:**
- Consumes: `InstanceStore` (Task 3).

**Requisitos funcionais** (mesmo espírito do plano iOS Task 9, mas **sem a armadilha do `dismiss()`** — ver spec Android seção 5: navegação por rota empilhada com `NavController`, retorno explícito via `popBackStack()` chamado no callback de conclusão do fluxo de onboarding, não por engano assumido como automático):
- Lista de instâncias com a ativa marcada, tap troca a ativa.
- Botão "Adicionar instância" navega pra uma nova instância do grafo de onboarding (Task 5) empilhada por cima desta tela — ao finalizar (mesmo callback de conclusão da Task 5), o fluxo faz `popBackStack()` de volta pra esta lista.
- Swipe-to-dismiss ou botão remover, chamando `instanceStore.remove(_:)`. **Mesma lacuna documentada no iOS**: sem chamada de `DELETE /push/devices/:id` ainda (não existe device-token id armazenado até a Task 10) — deixar comentário `// TODO(Task 10)` explicando, não inventar o comportamento.

- [ ] **Step 1: Implementar**
- [ ] **Step 2: Build + instalar**
- [ ] **Step 3: Commit**

```bash
git add apps/android
git commit -m "App Android: tela de instâncias (trocar/adicionar/remover)"
```

---

### Task 10: Push notification (Firebase) e deep link

**Files:**
- Modify: `apps/android/app/build.gradle.kts` (Firebase BoM + `firebase-messaging-ktx`, plugin condicional)
- Modify: `apps/android/build.gradle.kts` (plugin `com.google.gms.google-services`, aplicado condicionalmente)
- Create: `apps/android/app/src/main/java/com/velix/app/core/PushManager.kt`
- Modify: `apps/android/app/src/main/java/com/velix/app/VelixApplication.kt`

**Interfaces:**
- Consumes: `AppSession`, `ApiClient.post` (Task 2), `Instance` (Task 3).
- Produces: registro de push funcional (quando configurado) sem quebrar o app quando não configurado; `PushManager.handleNotificationTap` decide navegação.

**Aplica a lição #4 da spec (seção 2/6) desde o início — não é opcional, é o ponto central desta task:**

- [ ] **Step 1: Plugin do Google Services condicional**

Em `apps/android/build.gradle.kts` (raiz), adicionar o plugin do Google Services como `apply false`:
```kotlin
plugins {
    // ...já existentes
    id("com.google.gms.google-services") version "4.4.2" apply false
}
```
Em `apps/android/app/build.gradle.kts`, aplicar condicionalmente, só se o arquivo existir:
```kotlin
if (file("google-services.json").exists()) {
    apply(plugin = "com.google.gms.google-services")
}
```
Isso evita que o build inteiro falhe (comportamento padrão do plugin sem o arquivo) enquanto não existir um projeto Firebase real (sub-projeto 5).

- [ ] **Step 2: Dependência do Firebase**

`gradle/libs.versions.toml`: `firebaseBom = "33.7.0"`, libs `firebase-bom` (platform) e `firebase-messaging-ktx`. Em `app/build.gradle.kts`:
```kotlin
implementation(platform(libs.firebase.bom))
implementation(libs.firebase.messaging.ktx)
```

- [ ] **Step 3: `PushManager.kt`**

```kotlin
package com.velix.app.core

import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.tasks.await

@Serializable
private data class RegisterDeviceBody(val platform: String = "android", val fcmToken: String)

object PushManager {
    var pendingDeepLinkServerId: String? = null
    var pendingDeepLinkInstanceId: String? = null

    /** Firebase só existe de verdade se google-services.json estava presente
     * no build (ver Task 10 Step 1) — sem isso, FirebaseApp nunca inicializa
     * e qualquer chamada a FirebaseMessaging derrubaria o app. */
    private fun firebaseConfigured(): Boolean = FirebaseApp.getApps(/* context */ null as android.content.Context? ?: return false).isNotEmpty()

    suspend fun registerCurrentToken(instance: Instance, apiClient: ApiClient) {
        if (!firebaseConfigured()) return
        val token = try { FirebaseMessaging.getInstance().token.await() } catch (e: Exception) { return }
        try {
            apiClient.post<Unit>("/push/devices", RegisterDeviceBody(fcmToken = token))
        } catch (e: Exception) {
            // falha de registro não deve derrubar o fluxo de login/onboarding
        }
    }

    fun handleNotificationTap(serverId: String?, activeInstanceId: String?) {
        pendingDeepLinkServerId = serverId
        pendingDeepLinkInstanceId = activeInstanceId
    }
}
```

(O parâmetro de `firebaseConfigured()` acima está deliberadamente incompleto — `FirebaseApp.getApps(context)` precisa de um `Context` de verdade, não `null`. Corrigir isso na implementação real: `PushManager` precisa receber um `Context` — via `Application` injetado no construtor, ou tornando `PushManager` não um `object` singleton mas uma classe instanciada com `Context` a partir de `VelixApplication`. Usar o julgamento de quem implementar pra resolver isso de forma limpa; o ponto crítico não negociável é: **nenhuma chamada a `FirebaseMessaging`/`Firebase.messaging` pode acontecer sem antes confirmar que o Firebase foi inicializado**, do jeito que fizer sentido em Kotlin idiomático.)

- [ ] **Step 4: Criar um `FirebaseMessagingService` pra receber notificações e tocar**

```kotlin
package com.velix.app.core

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class VelixMessagingService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        // notificações em foreground: o sistema não mostra banner sozinho pra
        // mensagens "data-only"; se o backend manda notification+data, o SO já
        // trata em background/killed automaticamente. Meta desta fase: só
        // garantir que o clique abre no lugar certo (ver AndroidManifest pro
        // PendingIntent do FirebaseMessagingService, que já inclui os "extras"
        // do data payload automaticamente).
    }
}
```
Registrar em `AndroidManifest.xml` com um `<service>` + `<intent-filter>` de `com.google.firebase.MESSAGING_EVENT`, seguindo a documentação padrão do FCM pra Android (o serviço citado acima cobre background/killed automaticamente via o comportamento padrão do FCM; tratamento explícito de tap fica em `MainActivity.onNewIntent`/`onCreate` lendo os extras do `Intent`, chamando `PushManager.handleNotificationTap`).

- [ ] **Step 5: Ligar o registro do token em `VelixApplication`/`MainActivity`**

Registrar a instância ativa ao iniciar (mesma lógica do iOS: chama `PushManager.registerCurrentToken` pra instância ativa depois do launch, e também logo após `instanceStore.add(...)` num novo login/2FA bem-sucedido, na Task 5 — se isso não tiver sido antecipado na Task 5, adicionar aqui).

- [ ] **Step 6: Build + instalar**

```bash
cd apps/android && ./gradlew assembleDebug
"$ANDROID_HOME/platform-tools/adb" install -r app/build/outputs/apk/debug/app-debug.apk
"$ANDROID_HOME/platform-tools/adb" shell am start -n com.velix.app/.MainActivity
```
Expected: builda mesmo sem `google-services.json` (plugin condicional funcionando), instala e abre sem crash — **confirmar isso explicitamente rodando o app de verdade no emulador, não só o build**, exatamente a lição que o app iOS só descobriu na verificação final (Task 11) por não ter testado o lançamento real antes.

- [ ] **Step 7: Commit**

```bash
git add apps/android
git commit -m "App Android: registro de push (Firebase) e deep link de notificação"
```

---

### Task 11: Verificação final — build, testes, emulador

**Files:** nenhum arquivo novo.

- [ ] **Step 1: Build completo**

```bash
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
cd apps/android && ./gradlew assembleDebug
```
Expected: `BUILD SUCCESSFUL`

- [ ] **Step 2: Todos os testes JVM**

```bash
cd apps/android && ./gradlew test
```
Expected: `BUILD SUCCESSFUL`, todos os testes passando.

- [ ] **Step 3: Lançamento real no emulador — não pular esta etapa mesmo com o build passando**

```bash
export ANDROID_HOME="/Users/jhonata/Library/Android/sdk"
"$ANDROID_HOME/platform-tools/adb" install -r apps/android/app/build/outputs/apk/debug/app-debug.apk
"$ANDROID_HOME/platform-tools/adb" shell am start -n com.velix.app/.MainActivity
sleep 3
"$ANDROID_HOME/platform-tools/adb" shell dumpsys activity activities | grep -i velix
```
Expected: a Activity aparece como em execução, sem crash. Se travar, checar `adb logcat -d | tail -100` pelo stack trace — **este é exatamente o tipo de problema que só aparece rodando de verdade, não só compilando** (ver o crash do Firebase no app iOS, achado só nesta mesma etapa do plano iOS).

- [ ] **Step 4: Verificação visual no emulador** (feita pelo controlador da sessão)

Navegar as telas alcançáveis sem backend real disponível (formulários de onboarding), capturar screenshot de cada uma.

- [ ] **Step 5: Nenhum commit nesta task — é só verificação.**
