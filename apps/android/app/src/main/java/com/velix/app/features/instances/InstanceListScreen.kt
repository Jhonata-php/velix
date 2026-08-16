package com.velix.app.features.instances

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.velix.app.core.Instance
import com.velix.app.core.LocalAppSession

/**
 * Tela "Conta": lista as instâncias Velix logadas neste device, marca a ativa,
 * permite trocar (tap) e remover (botão). "Adicionar instância" empilha o
 * grafo de onboarding (Task 5) por cima desta tela via [onAddInstance] — quem
 * chama decide a rota (ver MainNavHost); esta tela só expõe o callback.
 *
 * Se a remoção esvaziar a lista, `MainActivity` observa
 * `instanceStore.instances` e troca a árvore inteira de volta pro onboarding
 * sozinho — nada a fazer aqui além de chamar `store.remove`.
 */
@Composable
fun InstanceListScreen(onAddInstance: () -> Unit) {
    val store = LocalAppSession.current.instanceStore
    val instances by store.instances.collectAsState()
    val activeInstance by store.activeInstance.collectAsState()

    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Text(
            "Instâncias",
            style = MaterialTheme.typography.headlineSmall,
            modifier = Modifier.padding(bottom = 8.dp),
        )
        LazyColumn(modifier = Modifier.weight(1f)) {
            items(instances, key = { it.id }) { instance ->
                InstanceRow(
                    instance = instance,
                    isActive = instance.id == activeInstance?.id,
                    onClick = { store.setActive(instance) },
                    onRemove = {
                        // TODO(Task 10): quando existir um device-token id salvo por
                        // instância (push notifications), chamar DELETE
                        // /push/devices/:id nessa instância antes de remover
                        // localmente. Por enquanto só limpa o lado do app.
                        store.remove(instance)
                    },
                )
                HorizontalDivider()
            }
        }
        Button(onClick = onAddInstance, modifier = Modifier.fillMaxWidth().padding(top = 16.dp)) {
            Text("Adicionar instância")
        }
    }
}

@Composable
private fun InstanceRow(
    instance: Instance,
    isActive: Boolean,
    onClick: () -> Unit,
    onRemove: () -> Unit,
) {
    ListItem(
        headlineContent = { Text(instance.displayName) },
        supportingContent = { Text(instance.userEmail) },
        leadingContent = if (isActive) {
            { Icon(Icons.Filled.CheckCircle, contentDescription = "Ativa", tint = MaterialTheme.colorScheme.primary) }
        } else {
            null
        },
        trailingContent = {
            IconButton(onClick = onRemove) {
                Icon(Icons.Filled.Delete, contentDescription = "Remover")
            }
        },
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
    )
}
