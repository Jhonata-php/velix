package com.velix.app.core

import androidx.compose.runtime.compositionLocalOf

class AppSession(val instanceStore: InstanceStore) {
    fun apiClient(instance: Instance): ApiClient = ApiClient(instance.baseUrl, instance.accessToken)

    val activeApiClient: ApiClient?
        get() = instanceStore.activeInstance.value?.let { apiClient(it) }
}

val LocalAppSession = compositionLocalOf<AppSession> { error("AppSession não fornecida") }
