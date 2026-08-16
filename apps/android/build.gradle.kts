plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    // apply false: sem projeto Firebase real ainda (precisa de conta própria do
    // usuário, só na fase de publicação nas lojas). Aplicado condicionalmente em
    // app/build.gradle.kts só quando google-services.json existir — ver Task 10.
    id("com.google.gms.google-services") version "4.4.2" apply false
}
