package com.velix.app.core

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/** Notificações em foreground: o sistema não mostra banner sozinho pra
 * mensagens "data-only"; se o backend manda notification+data, o SO já trata
 * em background/killed automaticamente. Meta desta fase: só garantir que o
 * clique abre no lugar certo — isso é tratado em `MainActivity`, lendo os
 * extras do `Intent` que o FCM já inclui automaticamente no tap (ver
 * AndroidManifest para o `<intent-filter>` deste serviço). */
class VelixMessagingService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        // Sem tratamento explícito nesta fase — ver comentário acima.
    }
}
