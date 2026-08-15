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
