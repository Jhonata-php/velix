package com.velix.app.core

import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.Serializable

@Serializable
data class LoginResponse(
    val accessToken: String? = null,
    val user: LoggedUser? = null,
)

@Serializable
data class LoggedUser(val name: String, val email: String, val role: String)

// Snapshot bruto guardado em `Server.metrics` (coluna Json) — formato de
// `parseMetrics` em apps/api/src/servers/metrics.util.ts, diferente do
// histórico agregado em `ServerMetricSample` (ver `MetricSample` abaixo):
// `diskPercent` vem como string ("42%"), não número, e o load average é
// uma lista de 3 posições, não um campo `loadAvg1` solto. Divergir disso faz
// o deserializer de `ServerSummary` quebrar assim que um servidor já tiver
// métrica coletada (mesmo bug corrigido no iOS).
@Serializable
data class ServerMetrics(
    val loadAvg: List<Double>? = null,
    val memUsedMb: Int? = null,
    val memTotalMb: Int? = null,
    val diskPercent: String? = null,
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

// GET /servers/:id/applications (applications.service.ts:63) — projetos
// implantados nesse servidor. `domains`/`deployments` do backend carregam bem
// mais campo do que precisamos aqui; kotlinx.serialization ignora o resto
// sozinho (ignoreUnknownKeys, ver ApiClient).
@Serializable
data class ProjectDomain(val hostname: String)

@Serializable
data class ProjectSummary(
    val id: String,
    val name: String,
    val status: String,
    val tags: List<String> = emptyList(),
    val domains: List<ProjectDomain> = emptyList(),
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

// encodeDefaults=false (o padrão do Json) omite qualquer campo cujo valor bata
// com o default declarado — inclusive null==null — independente de
// explicitNulls. Sem @EncodeDefault(ALWAYS) aqui, cpuPercent/temperatureCelsius
// nulos somem da chave em vez de virar "null" explícito (o mesmo bug do iOS
// que o teste disabledThresholdFieldSerializesAsExplicitNull trava).
@OptIn(ExperimentalSerializationApi::class)
@Serializable
data class ThresholdUpdateBody(
    @EncodeDefault(EncodeDefault.Mode.ALWAYS) val cpuPercent: Int? = null,
    @EncodeDefault(EncodeDefault.Mode.ALWAYS) val memoryPercent: Int? = null,
    @EncodeDefault(EncodeDefault.Mode.ALWAYS) val temperatureCelsius: Int? = null,
    @EncodeDefault(EncodeDefault.Mode.ALWAYS) val dockerScope: String? = null,
    @EncodeDefault(EncodeDefault.Mode.ALWAYS) val dockerEnabled: Boolean? = null,
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
