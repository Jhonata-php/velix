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

class ApiClient(
    @PublishedApi internal val baseUrl: String,
    @PublishedApi internal var token: String? = null,
) {
    @PublishedApi
    internal val json = Json { ignoreUnknownKeys = true }

    @PublishedApi
    internal val client = HttpClient(OkHttp) {
        install(ContentNegotiation) { json(json) }
    }

    @PublishedApi
    internal suspend inline fun <reified T> request(
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
