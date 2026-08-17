package com.velix.app.features.onboarding

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.velix.app.core.ApiClient
import com.velix.app.core.ApiException
import com.velix.app.core.LocalAppSession
import com.velix.app.core.LoginRequestBody
import com.velix.app.core.LoginResponse
import com.velix.app.ui.theme.ErrorBanner
import com.velix.app.ui.theme.VelixAuthHeader
import com.velix.app.ui.theme.VelixPurple
import kotlinx.coroutines.launch

/** Segunda tela do onboarding: e-mail/senha pra `POST /auth/login`.
 *
 * A detecção de 2FA (`totp_required`/`totp_invalid`) acontece SÓ no catch de
 * `ApiException.Http.reason` — o backend nunca manda esse reason num 2xx, então
 * `LoginResponse` (o DTO de sucesso) nem tem esse campo. Ver AGENTS/plano —
 * esse é o ponto que o app iOS errou na primeira tentativa.
 */
@Composable
fun LoginScreen(
    baseUrl: String,
    onFinished: () -> Unit,
    onTwoFactorRequired: (email: String, password: String, rememberMe: Boolean) -> Unit,
) {
    val session = LocalAppSession.current
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var rememberMe by remember { mutableStateOf(false) }
    var isLoading by remember { mutableStateOf(false) }
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
        val host = remember(baseUrl) { baseUrl.substringAfter("://") }
        VelixAuthHeader(
            title = "Entrar",
            subtitle = "Use as mesmas credenciais do painel web em $host.",
        )

        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            OutlinedTextField(
                value = email,
                onValueChange = {
                    email = it
                    errorMessage = null
                },
                label = { Text("E-mail") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = password,
                onValueChange = {
                    password = it
                    errorMessage = null
                },
                label = { Text("Senha") },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                modifier = Modifier.fillMaxWidth(),
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = rememberMe, onCheckedChange = { rememberMe = it })
                Text("Lembrar de mim")
            }
        }

        errorMessage?.let {
            ErrorBanner(text = it)
        }

        Button(
            onClick = {
                errorMessage = null
                isLoading = true
                scope.launch {
                    try {
                        val client = ApiClient(baseUrl)
                        val response = client.post<LoginResponse>(
                            "/auth/login",
                            LoginRequestBody(email = email, password = password, totpCode = null, rememberMe = rememberMe),
                        )
                        val instance = completeLogin(session, baseUrl, response)
                        if (instance != null) {
                            onFinished()
                        } else {
                            errorMessage = "Não foi possível entrar"
                        }
                    } catch (e: ApiException.Http) {
                        // 2FA exigido/código inválido chega como 401 com esse
                        // reason no corpo — nunca como campo de uma resposta 2xx.
                        if (e.reason == "totp_required" || e.reason == "totp_invalid") {
                            onTwoFactorRequired(email, password, rememberMe)
                        } else {
                            errorMessage = e.serverMessage ?: "Erro ao entrar"
                        }
                    } catch (e: ApiException) {
                        errorMessage = "Erro ao entrar"
                    } finally {
                        isLoading = false
                    }
                }
            },
            enabled = email.isNotBlank() && password.isNotBlank() && !isLoading,
            modifier = Modifier.fillMaxWidth().height(52.dp),
        ) {
            if (isLoading) {
                CircularProgressIndicator(modifier = Modifier.size(20.dp))
            } else {
                Text("Entrar")
            }
        }
    }
}
