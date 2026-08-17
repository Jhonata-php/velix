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
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.text.input.KeyboardType
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

/** Terceira tela do onboarding: reenvia `POST /auth/login` com `totpCode`
 * preenchido, usando o e-mail/senha capturados na LoginScreen. */
@Composable
fun TwoFactorScreen(
    baseUrl: String,
    email: String,
    password: String,
    rememberMe: Boolean,
    onFinished: () -> Unit,
) {
    val session = LocalAppSession.current
    var code by remember { mutableStateOf("") }
    var useRecoveryCode by remember { mutableStateOf(false) }
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
        VelixAuthHeader(
            title = "Verificação em duas etapas",
            subtitle = if (useRecoveryCode) {
                "Digite um dos seus códigos de recuperação."
            } else {
                "Digite o código de 6 dígitos do seu autenticador."
            },
        )

        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            OutlinedTextField(
                value = code,
                onValueChange = { newValue ->
                    // Modo autenticador: só dígitos, no máximo 6 — teclado numérico
                    // sozinho não impede colar texto, então filtra de verdade aqui.
                    // Modo recuperação: texto livre, sem filtro/limite.
                    code = if (useRecoveryCode) newValue else newValue.filter { it.isDigit() }.take(6)
                    errorMessage = null
                },
                label = { Text(if (useRecoveryCode) "Código de recuperação" else "Código de 6 dígitos") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(
                    keyboardType = if (useRecoveryCode) KeyboardType.Text else KeyboardType.Number,
                ),
                modifier = Modifier.fillMaxWidth(),
            )
            TextButton(onClick = {
                useRecoveryCode = !useRecoveryCode
                code = ""
                errorMessage = null
            }) {
                Text(if (useRecoveryCode) "Usar código do autenticador" else "Usar código de recuperação")
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
                            LoginRequestBody(email = email, password = password, totpCode = code, rememberMe = rememberMe),
                        )
                        val instance = completeLogin(session, baseUrl, response)
                        if (instance != null) {
                            onFinished()
                        } else {
                            errorMessage = "Código inválido"
                        }
                    } catch (e: ApiException.Http) {
                        errorMessage = e.serverMessage ?: "Código inválido"
                    } catch (e: ApiException) {
                        errorMessage = "Erro ao confirmar"
                    } finally {
                        isLoading = false
                    }
                }
            },
            enabled = code.isNotBlank() && !isLoading,
            modifier = Modifier.fillMaxWidth().height(52.dp),
        ) {
            if (isLoading) {
                CircularProgressIndicator(modifier = Modifier.size(20.dp))
            } else {
                Text("Confirmar")
            }
        }
    }
}
