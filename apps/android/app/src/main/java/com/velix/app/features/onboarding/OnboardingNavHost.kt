package com.velix.app.features.onboarding

import androidx.compose.runtime.Composable
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.toRoute
import com.velix.app.core.AppSession
import com.velix.app.core.Instance
import com.velix.app.core.LoginResponse
import kotlinx.serialization.Serializable
import java.net.URI
import java.util.UUID

/** Rotas do fluxo de onboarding (adicionar instância → login → 2FA), tipadas via
 * kotlinx.serialization — suportado nativamente pelo navigation-compose 2.8+,
 * então email/senha/rememberMe/baseUrl viajam como campos de verdade entre telas
 * em vez de string de rota montada à mão. */
sealed interface OnboardingRoute {
    @Serializable
    data object AddInstance : OnboardingRoute

    @Serializable
    data class Login(val baseUrl: String) : OnboardingRoute

    @Serializable
    data class TwoFactor(
        val baseUrl: String,
        val email: String,
        val password: String,
        val rememberMe: Boolean,
    ) : OnboardingRoute
}

/** Monta a `Instance` a partir de uma resposta de `/auth/login` bem-sucedida e a
 * adiciona à sessão — chamada tanto pelo login direto (LoginScreen) quanto pelo
 * reenvio pós-2FA (TwoFactorScreen), pra não duplicar a lógica de conclusão do
 * onboarding. Retorna `null` se a resposta não trouxer token/usuário (não deveria
 * acontecer num 2xx de verdade, mas cobre o caso defensivamente). */
fun completeLogin(session: AppSession, baseUrl: String, response: LoginResponse): Instance? {
    val token = response.accessToken ?: return null
    val user = response.user ?: return null
    val displayName = try {
        URI(baseUrl).host ?: baseUrl
    } catch (e: Exception) {
        baseUrl
    }
    val instance = Instance(
        id = UUID.randomUUID().toString(),
        baseUrl = baseUrl,
        displayName = displayName,
        userEmail = user.email,
        accessToken = token,
    )
    session.instanceStore.add(instance)
    return instance
}

@Composable
fun OnboardingNavHost(onFinished: () -> Unit) {
    val navController = rememberNavController()
    NavHost(navController = navController, startDestination = OnboardingRoute.AddInstance) {
        composable<OnboardingRoute.AddInstance> {
            AddInstanceScreen(
                onReachable = { baseUrl -> navController.navigate(OnboardingRoute.Login(baseUrl)) },
            )
        }
        composable<OnboardingRoute.Login> { backStackEntry ->
            val route = backStackEntry.toRoute<OnboardingRoute.Login>()
            LoginScreen(
                baseUrl = route.baseUrl,
                onFinished = onFinished,
                onTwoFactorRequired = { email, password, rememberMe ->
                    navController.navigate(OnboardingRoute.TwoFactor(route.baseUrl, email, password, rememberMe))
                },
            )
        }
        composable<OnboardingRoute.TwoFactor> { backStackEntry ->
            val route = backStackEntry.toRoute<OnboardingRoute.TwoFactor>()
            TwoFactorScreen(
                baseUrl = route.baseUrl,
                email = route.email,
                password = route.password,
                rememberMe = route.rememberMe,
                onFinished = onFinished,
            )
        }
    }
}
