package com.velix.app

import android.app.Application
import com.velix.app.core.PushManager

class VelixApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        // Único lugar que decide se Firebase foi inicializado de verdade (só
        // acontece se google-services.json existia no build — ver Task 10). O
        // resultado fica em cache no PushManager; nenhum outro ponto do app
        // precisa de Context pra checar isso de novo.
        PushManager.configure(this)
    }
}
