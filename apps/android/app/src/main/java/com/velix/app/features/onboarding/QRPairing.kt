package com.velix.app.features.onboarding

import android.content.Context
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScanner
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import com.velix.app.core.ApiClient
import com.velix.app.core.LoginResponse
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

private val pairingJson = Json { ignoreUnknownKeys = true }

@Serializable
private data class PairingPayload(val baseUrl: String, val token: String)

@Serializable
private data class RedeemPairingBody(val token: String)

class PairingCancelledException : Exception("Escaneamento cancelado")

/** Abre o scanner de QR code do Google Play Services — sem UI de câmera
 * própria pra escrever nem permissão de câmera pra pedir, o próprio Play
 * Services cuida dos dois. Usado só pro payload de pareamento do
 * MobilePairingCard (painel web): `{baseUrl, token}`. */
private suspend fun scanQrCode(context: Context): String = suspendCancellableCoroutine { cont ->
    val options = GmsBarcodeScannerOptions.Builder()
        .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
        .build()
    val scanner: GmsBarcodeScanner = GmsBarcodeScanning.getClient(context, options)
    scanner.startScan()
        .addOnSuccessListener { barcode ->
            val raw = barcode.rawValue
            if (raw != null) cont.resume(raw) else cont.resumeWithException(PairingCancelledException())
        }
        .addOnCanceledListener { cont.resumeWithException(PairingCancelledException()) }
        .addOnFailureListener { e -> cont.resumeWithException(e) }
}

/** Escaneia + troca o token pelo login em `/auth/pairing/redeem` (ver
 * `MobilePairingCard` no painel web e `DevicePairingTokenService` na API) —
 * mesmo formato de resposta do login normal, sem digitar domínio/e-mail/senha. */
suspend fun scanAndRedeemPairing(context: Context): Pair<String, LoginResponse> {
    val raw = scanQrCode(context)
    val payload = try {
        pairingJson.decodeFromString<PairingPayload>(raw)
    } catch (e: Exception) {
        throw IllegalArgumentException("QR code inválido.")
    }
    val response = ApiClient(payload.baseUrl).post<LoginResponse>("/auth/pairing/redeem", RedeemPairingBody(payload.token))
    return payload.baseUrl to response
}
