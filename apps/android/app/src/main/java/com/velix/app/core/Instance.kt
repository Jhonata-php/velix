package com.velix.app.core

import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

@Serializable
data class Instance(
    val id: String,
    val baseUrl: String,
    val displayName: String,
    val userEmail: String,
    val accessToken: String,
)

/** Lista de instâncias Velix logadas — "multi-servidor" no app é
 * multi-instância, não multi-servidor dentro de uma instância só (ver spec de
 * UX, seção 2). */
class InstanceStore(private val store: KeyValueStore) {
    private val json = Json { ignoreUnknownKeys = true }
    private val storageKey = "instances"
    private val activeKey = "active_instance_id"

    private val _instances = MutableStateFlow<List<Instance>>(emptyList())
    val instances: StateFlow<List<Instance>> = _instances.asStateFlow()

    private val _activeInstance = MutableStateFlow<Instance?>(null)
    val activeInstance: StateFlow<Instance?> = _activeInstance.asStateFlow()

    init { load() }

    fun add(instance: Instance) {
        _instances.update { it + instance }
        if (_activeInstance.value == null) _activeInstance.value = instance
        persist()
    }

    fun remove(instance: Instance) {
        _instances.update { list -> list.filterNot { it.id == instance.id } }
        if (_activeInstance.value?.id == instance.id) {
            _activeInstance.value = _instances.value.firstOrNull()
        }
        persist()
    }

    fun setActive(instance: Instance) {
        if (_instances.value.none { it.id == instance.id }) return
        _activeInstance.value = instance
        persist()
    }

    private fun persist() {
        store.save(storageKey, json.encodeToString(_instances.value))
        _activeInstance.value?.let { store.save(activeKey, it.id) } ?: store.delete(activeKey)
    }

    private fun load() {
        val raw = store.read(storageKey) ?: return
        val decoded = try { json.decodeFromString<List<Instance>>(raw) } catch (e: Exception) { return }
        _instances.value = decoded
        val activeId = store.read(activeKey)
        _activeInstance.value = decoded.firstOrNull { it.id == activeId } ?: decoded.firstOrNull()
    }
}
