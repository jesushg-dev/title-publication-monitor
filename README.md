# Monitor de publicación del título

El flujo [`.github/workflows/title-publication-monitor.yml`](.github/workflows/title-publication-monitor.yml) consulta los registros `2026-TP30799`, `2026-TP30796` y `2026-TP29824` en La Gaceta cada día a las 8:30, 10:30, 12:00, 13:30, 15:30 y 17:15, hora de Nicaragua (`America/Managua`). GitHub Actions ejecuta los cron en UTC, por eso el archivo usa 14:30, 16:30, 18:00, 19:30, 21:30 y 23:15 UTC.

Envía un mensaje de Telegram en cada comprobación con un saludo personalizado y los detalles del título. Si hay un cambio en el estado, número de Gaceta, enlace, fecha de publicación o fecha de errata, el mensaje incluye el detalle de los valores anterior y nuevo.

## Configuración en GitHub

1. Crea un bot con [@BotFather](https://t.me/BotFather) y guarda el token que entrega.
2. Envíale cualquier mensaje a tu bot.
3. Abre `https://api.telegram.org/bot<TU_TOKEN>/getUpdates` y copia el valor de `message.chat.id`.
4. En el repositorio, ve a **Settings → Secrets and variables → Actions** y crea estos secretos:
   - `TELEGRAM_BOT_TOKEN`: el token del bot.
   - `TELEGRAM_CHAT_ID`: el `chat.id` que obtuviste.
5. Abre **Actions → Monitor title publication → Run workflow** para comprobar el primer mensaje.

El estado previo se guarda en la caché de GitHub Actions. Si esa caché vence o se elimina, la siguiente ejecución se identificará como la primera comprobación y luego continuará comparando normalmente.

GitHub puede retrasar los cron durante periodos de mucha demanda, por lo que no se garantiza que el aviso llegue exactamente a la hora indicada.

Para probar la consulta localmente sin enviar Telegram, ejecuta:

```bash
TITLE_MONITOR_DRY_RUN=true node scripts/check-lagaceta-title.mjs
```
