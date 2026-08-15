package com.velix.app.core

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

interface KeyValueStore {
    fun save(key: String, value: String)
    fun read(key: String): String?
    fun delete(key: String)
}

/** Wrapper fino sobre EncryptedSharedPreferences — equivalente Android do
 * Keychain do iOS, biblioteca oficial do Jetpack, sem dependência de terceiro. */
class SecureStore(context: Context) : KeyValueStore {
    private val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()

    private val prefs = EncryptedSharedPreferences.create(
        context,
        "velix_secure_prefs",
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    override fun save(key: String, value: String) {
        prefs.edit().putString(key, value).apply()
    }

    override fun read(key: String): String? = prefs.getString(key, null)

    override fun delete(key: String) {
        prefs.edit().remove(key).apply()
    }
}
