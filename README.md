# Monitor de publicación de títulos en La Gaceta

El flujo [`.github/workflows/title-publication-monitor.yml`](.github/workflows/title-publication-monitor.yml) consulta los títulos profesionales en La Gaceta de Nicaragua de **lunes a sábado** a las 8:30, 10:30, 12:00, 13:30, 15:30 y 17:15, hora de Nicaragua (`America/Managua`). Los domingos no se realizan comprobaciones ya que La Gaceta no opera ni publica actualizaciones ese día. GitHub Actions ejecuta los cron en UTC (14:30, 16:30, 18:00, 19:30, 21:30 y 23:15 UTC de lunes a sábado con expresión `1-6`).

### 👥 Títulos monitoreados:
- `2026-TP30799`: Jesús Enmanuel Hernández González
- `2026-TP29824`: Luis Emilio Díaz Gutiérrez
- `Danilo Jose Acevedo Cisnero`: Monitoreo activo por nombre (búsqueda continua en La Gaceta hasta que la universidad ingrese el trámite y se le asigne su número de registro oficial).

### 🚀 Características principales:
- **📊 Tablero Resumen Unificado:** En cada comprobación se envía un único mensaje consolidado tipo panel de control con el estado de todos los títulos.
- **⏱️ Estimador de tiempo de publicación:** Basado en la velocidad real de publicación de La Gaceta (~1,500 trámites semanales / 300 diarios) y la distancia con respecto al frente de publicación actual.
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

El estado previo se guarda en la caché de GitHub Actions. Si esa caché vence o se elimina, la siguiente ejecución se identificará como la primera comprobación y luego continuará comparando normalmente.

Para probar la consulta localmente sin enviar Telegram, ejecuta:

```bash
TITLE_MONITOR_DRY_RUN=true node scripts/check-lagaceta-title.mjs
```
