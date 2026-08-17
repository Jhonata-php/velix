package com.velix.app.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

val VelixPurple = Color(0xFF7C3AED)
val VelixPurpleDark = Color(0xFF5B21B6)

private val LightColors = lightColorScheme(
    primary = VelixPurple,
    onPrimary = Color.White,
    secondary = VelixPurpleDark,
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFFA78BFA),
    onPrimary = Color(0xFF1E1033),
    secondary = VelixPurple,
)

/** Tema compartilhado por todo o app — sem isso, os componentes Material3
 * caem no roxo genérico padrão da lib em vez da cor de marca do Velix. */
@Composable
fun VelixTheme(content: @Composable () -> Unit) {
    val isDark = androidx.compose.foundation.isSystemInDarkTheme()
    MaterialTheme(
        colorScheme = if (isDark) DarkColors else LightColors,
        content = content,
    )
}
