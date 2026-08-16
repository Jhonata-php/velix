package com.velix.app.features.onboarding

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.velix.app.core.ApiClient
import com.velix.app.core.ApiException
import kotlinx.coroutines.launch

/** Primeira tela do onboarding: usuário digita o domínio da instância Velix
 * própria. Em caso de sucesso na checagem de alcance, `onReachable` navega pra
 * LoginScreen com a base URL resolvida (ver OnboardingNavHost). */
@Composable
fun AddInstanceScreen(onReachable: (baseUrl: String) -> Unit) {
    var domainText by remember { mutableStateOf("") }
    var isChecking by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text("Adicionar instância", style = MaterialTheme.typography.headlineSmall)
        OutlinedTextField(
            value = domainText,
            onValueChange = {
                domainText = it
                errorMessage = null
            },
            label = { Text("dominio.com") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        Text("Com ou sem https://, tanto faz.", style = MaterialTheme.typography.bodySmall)
        errorMessage?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        Button(
            onClick = {
                val baseUrl = normalizeBaseUrl(domainText)
                if (baseUrl == null) {
                    errorMessage = "Domínio inválido"
                    return@Button
                }
                errorMessage = null
                isChecking = true
                scope.launch {
                    // ApiException.Network = falha de rede/DNS (não alcançável).
                    // ApiException.Http (mesmo 404/500) ou sucesso = alcançável.
                    val reachable = try {
                        ApiClient(baseUrl).get<Unit>("/")
                        true
                    } catch (e: ApiException.Http) {
                        true
                    } catch (e: ApiException.Decoding) {
                        true
                    } catch (e: ApiException.Network) {
                        false
                    }
                    isChecking = false
                    if (reachable) {
                        onReachable(baseUrl)
                    } else {
                        errorMessage = "Não foi possível conectar nesse endereço"
                    }
                }
            },
            enabled = domainText.isNotBlank() && !isChecking,
            modifier = Modifier.fillMaxWidth(),
        ) {
            if (isChecking) {
                CircularProgressIndicator(modifier = Modifier.size(20.dp))
            } else {
                Text("Continuar")
            }
        }
    }
}

/** Aceita domínio com ou sem esquema; adiciona `https://` quando ausente. */
internal fun normalizeBaseUrl(text: String): String? {
    val trimmed = text.trim()
    if (trimmed.isEmpty()) return null
    val lower = trimmed.lowercase()
    return if (lower.startsWith("http://") || lower.startsWith("https://")) trimmed else "https://$trimmed"
}
