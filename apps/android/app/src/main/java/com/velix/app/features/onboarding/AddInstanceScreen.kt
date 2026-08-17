package com.velix.app.features.onboarding

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.unit.dp
import com.velix.app.core.ApiClient
import com.velix.app.core.ApiException
import com.velix.app.ui.theme.ErrorBanner
import com.velix.app.ui.theme.VelixAuthHeader
import com.velix.app.ui.theme.VelixPurple
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
        modifier = Modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(
                    listOf(VelixPurple.copy(alpha = 0.08f), MaterialTheme.colorScheme.background),
                ),
            )
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp, vertical = 32.dp),
        verticalArrangement = Arrangement.spacedBy(24.dp),
    ) {
        VelixAuthHeader(
            title = "Adicionar instância",
            subtitle = "Informe o domínio do painel Velix que você administra.",
        )

        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
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
        }

        errorMessage?.let {
            ErrorBanner(text = it)
        }

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
            modifier = Modifier.fillMaxWidth().height(52.dp),
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
