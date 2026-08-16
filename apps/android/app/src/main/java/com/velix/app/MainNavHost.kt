package com.velix.app

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.toRoute
import com.velix.app.features.dashboard.DashboardScreen
import com.velix.app.features.instances.InstanceListScreen
import com.velix.app.features.notifications.NotificationSettingsScreen
import com.velix.app.features.onboarding.OnboardingNavHost
import com.velix.app.features.serverdetail.ServerDetailScreen
import kotlinx.serialization.Serializable

/** Rotas da árvore pós-onboarding: os 3 destinos da bottom nav mais o detalhe
 * de servidor (fora da bottom nav, alcançado a partir do dashboard) e o fluxo
 * de onboarding reaproveitado (empilhado por cima da aba Conta, pra adicionar
 * uma instância sem sair do NavController principal — ver InstanceListScreen). */
sealed interface MainRoute {
    @Serializable
    data object Dashboard : MainRoute

    @Serializable
    data class ServerDetail(val serverId: String) : MainRoute

    @Serializable
    data object Notifications : MainRoute

    @Serializable
    data object Account : MainRoute

    @Serializable
    data object AddInstance : MainRoute
}

private data class BottomTab(val route: MainRoute, val label: String, val icon: ImageVector)

private val bottomTabs = listOf(
    BottomTab(MainRoute.Dashboard, "Dashboard", Icons.Filled.Home),
    BottomTab(MainRoute.Notifications, "Notificações", Icons.Filled.Notifications),
    BottomTab(MainRoute.Account, "Conta", Icons.Filled.AccountCircle),
)

/** NavHost pós-onboarding: bottom nav com Dashboard (real, Task 6),
 * Notificações e Conta (placeholders até Tasks 8-9). */
@Composable
fun MainNavHost() {
    val navController = rememberNavController()
    val backStackEntry by navController.currentBackStackEntryAsState()

    Scaffold(
        bottomBar = {
            NavigationBar {
                bottomTabs.forEach { tab ->
                    NavigationBarItem(
                        selected = backStackEntry?.destination?.hasRoute(tab.route::class) == true,
                        onClick = {
                            navController.navigate(tab.route) {
                                popUpTo(navController.graph.findStartDestination().id) { saveState = true }
                                launchSingleTop = true
                                restoreState = true
                            }
                        },
                        icon = { Icon(tab.icon, contentDescription = tab.label) },
                        label = { Text(tab.label) },
                    )
                }
            }
        },
    ) { padding ->
        NavHost(
            navController = navController,
            startDestination = MainRoute.Dashboard,
            modifier = Modifier.padding(padding),
        ) {
            composable<MainRoute.Dashboard> {
                DashboardScreen(
                    onServerClick = { server -> navController.navigate(MainRoute.ServerDetail(server.id)) },
                )
            }
            composable<MainRoute.ServerDetail> { backStackEntry ->
                val route = backStackEntry.toRoute<MainRoute.ServerDetail>()
                ServerDetailScreen(serverId = route.serverId)
            }
            composable<MainRoute.Notifications> {
                NotificationSettingsScreen()
            }
            composable<MainRoute.Account> {
                InstanceListScreen(onAddInstance = { navController.navigate(MainRoute.AddInstance) })
            }
            composable<MainRoute.AddInstance> {
                // Mesmo grafo de onboarding da Task 5, empilhado por cima desta tela
                // no MESMO NavController da bottom nav — popBackStack() no callback de
                // conclusão volta exatamente pra aba Conta (diferente do dismiss()
                // ambíguo do SwiftUI, aqui não tem chance de fechar o destino errado).
                OnboardingNavHost(onFinished = { navController.popBackStack() })
            }
        }
    }
}
