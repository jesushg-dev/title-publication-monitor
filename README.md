# Monitor de publicación de títulos en La Gaceta

El flujo [`.github/workflows/title-publication-monitor.yml`](.github/workflows/title-publication-monitor.yml) consulta los títulos profesionales en La Gaceta de Nicaragua de **lunes a sábado** a las 8:30, 10:30, 12:00, 13:30, 15:30 y 17:15, hora de Nicaragua (`America/Managua`). También se ejecuta al subir cambios a `main`. Los domingos no se realizan comprobaciones programadas. GitHub Actions ejecuta los cron en UTC (14:30, 16:30, 18:00, 19:30, 21:30 y 23:15 UTC de lunes a sábado con expresión `1-6`).

### 👥 Títulos monitoreados:
- `2026-TP30799`: Jesús Enmanuel Hernández González
- `2026-TP29824`: Luis Emilio Díaz Gutiérrez
- `Danilo Jose Acevedo Flores`: Monitoreo activo por nombre hasta que aparezca un número de registro oficial.

### 🚀 Características principales:
- **📊 Tablero Resumen Unificado:** En cada comprobación se envía un único mensaje consolidado tipo panel de control con el estado de todos los títulos.
- **📈 Avance y pendientes:** Consulta los registros del mismo año con formato `AÑO-TPnúmero` y cuenta los TP anteriores publicados y los que siguen pendientes. El porcentaje es la proporción publicada entre los anteriores; la barra de diez segmentos cabe en Telegram.
- **🗓️ Fecha estimada:** Divide los TP anteriores pendientes entre el ritmo real de publicación de esos TP durante los últimos 30 días. Es una aproximación, porque algunos expedientes antiguos se quedan pendientes mientras otros posteriores se publican. Si la búsqueda completa falla o no hay publicaciones recientes, el monitor no inventa un porcentaje ni una fecha.
- **🔘 Botones interactivos en Telegram:** Acceso directo a la página oficial de consultas y enlace de lectura de la edición de La Gaceta cuando un título sea publicado.
- **🚨 Alertas de cambios prioritarias:** Si se detecta un cambio de estado, número de Gaceta o ingreso oficial de un título pendiente, se destaca inmediatamente en la cabecera del mensaje.

## Configuración en GitHub

1. Crea un bot con [@BotFather](https://t.me/BotFather) y guarda el token que entrega.
2. Envíale cualquier mensaje a tu bot.
3. Abre `https://api.telegram.org/bot<TU_TOKEN>/getUpdates` y copia el valor de `message.chat.id`.
4. En el repositorio, ve a **Settings → Secrets and variables → Actions** y crea estos secretos:
   - `TELEGRAM_BOT_TOKEN`: el token del bot.
   - `TELEGRAM_CHAT_ID`: el `chat.id` que obtuviste.
5. Abre **Actions → Monitor title publication → Run workflow** para comprobar el primer mensaje.

Los registros confirmados y sus estimaciones se guardan como JSON en `.title-monitor-state/state.json` dentro de la caché de GitHub Actions. Cada ejecución correcta también adjunta ese archivo para descargarlo en **Actions → ejecución → Artifacts → title-records-...**. GitHub conserva el adjunto durante 90 días. Si la caché vence o se elimina, la siguiente ejecución se identificará como la primera comprobación y luego continuará comparando normalmente.

Para probar la consulta localmente sin enviar Telegram, ejecuta:

```bash
TITLE_MONITOR_DRY_RUN=true node scripts/check-lagaceta-title.mjs
```
