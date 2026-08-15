package com.velix.app.core

import org.junit.Test
import org.junit.Assert.*

class FakeKeyValueStore : KeyValueStore {
    private val map = mutableMapOf<String, String>()
    override fun save(key: String, value: String) { map[key] = value }
    override fun read(key: String): String? = map[key]
    override fun delete(key: String) { map.remove(key) }
}

class InstanceStoreTest {
    private fun newInstance(id: String, url: String) =
        Instance(id = id, baseUrl = url, displayName = url, userEmail = "$id@x.com", accessToken = "tok-$id")

    @Test
    fun addSetsAsActiveWhenFirst() {
        val store = InstanceStore(FakeKeyValueStore())
        val i1 = newInstance("i1", "https://a.com")
        store.add(i1)
        assertEquals(i1.id, store.activeInstance.value?.id)
        assertEquals(1, store.instances.value.size)
    }

    @Test
    fun removeActiveFallsBackToAnother() {
        val store = InstanceStore(FakeKeyValueStore())
        val i1 = newInstance("i1", "https://a.com")
        val i2 = newInstance("i2", "https://b.com")
        store.add(i1); store.add(i2); store.setActive(i1)
        store.remove(i1)
        assertEquals(i2.id, store.activeInstance.value?.id)
    }

    @Test
    fun removeLastLeavesNoActive() {
        val store = InstanceStore(FakeKeyValueStore())
        val i1 = newInstance("i1", "https://a.com")
        store.add(i1); store.remove(i1)
        assertNull(store.activeInstance.value)
        assertTrue(store.instances.value.isEmpty())
    }

    @Test
    fun persistsAcrossFreshInstanceOverSameBackingStore() {
        val backing = FakeKeyValueStore()
        val store1 = InstanceStore(backing)
        store1.add(newInstance("i1", "https://a.com"))

        val store2 = InstanceStore(backing)
        assertEquals(1, store2.instances.value.size)
        assertEquals("i1", store2.activeInstance.value?.id)
    }
}
