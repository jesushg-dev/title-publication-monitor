# Monitor de publicación de títulos en La Gaceta

El flujo [`.github/workflows/title-publication-monitor.yml`](.github/workflows/title-publication-monitor.yml) consulta los títulos profesionales en La Gaceta de Nicaragua de **lunes a viernes**. Los cron se programan a las 6:00, 8:00, 9:30, 11:00, 13:00 y 14:45, hora de Nicaragua (`America/Managua`): cada horario se adelantó 2 horas y 30 minutos respecto a los anteriores para compensar los retrasos observados en GitHub Actions. GitHub ejecuta los cron en UTC (12:00, 14:00, 15:30, 17:00, 19:00 y 20:45 UTC); el retraso puede variar y la hora de llegada no está garantizada. También se ejecuta al subir cambios a `main`.

### 👥 Títulos monitoreados:
- `2026-TP30799`: Jesús Enmanuel Hernández González
- `2026-TP29824`: Luis Emilio Díaz Gutiérrez
- `Danilo Jose Acevedo Flores`: Monitoreo activo por nombre hasta que aparezca un número de registro oficial.

### 🚀 Características principales:
- **📊 Notificaciones:** Los cambios de los registros, los cambios en la cantidad de TP pendientes o publicados desde el ingreso y los errores de consulta se notifican en cuanto se detectan. Si todos los registros siguen iguales, el bot omite los mensajes intermedios y envía un único resumen de «sin cambios» en la última revisión programada del día. Las ejecuciones manuales y por cambios de código siguen enviando el tablero.
- **🧹 Chat más limpio:** El bot envía un mensaje nuevo para que llegue la notificación y después borra su último mensaje guardado si Telegram todavía permite borrarlo (menos de 48 horas desde que se envió). Tras una pausa más larga, como un fin de semana, ese mensaje anterior puede permanecer en el chat.
- **📈 Avance desde el ingreso:** Consulta los registros del mismo año con formato `AÑO-TPnúmero`. La barra muestra qué proporción de los TP anteriores que estaban pendientes al ingresar el título se ha publicado desde entonces. Usa las fechas oficiales de ingreso y publicación; excluye los pocos registros sin fecha verificable y marca el porcentaje como aproximado. Si faltan demasiadas fechas, omite el porcentaje. También muestra cuántos TP anteriores siguen pendientes ahora.
- **🗓️ Rango estimado:** Cuenta todos los TP anteriores pendientes, incluidos los rezagados. Calcula publicaciones por día hábil a partir de 40 días de publicación (aproximadamente ocho semanas), combina el promedio de los 20 días más recientes con el de los 40, y usa la variación entre períodos de 20 días para obtener un rango. Los TP con número mayor que el consultado no afectan este cálculo. El rango puede adelantarse o atrasarse cuando cambian los pendientes o el ritmo observado; no es una fecha garantizada.
- **📆 Calendario de publicación:** La proyección omite fines de semana, feriados nacionales, los asuetos del 2 y 9 de noviembre de 2026 y las vacaciones del sector público del 24 de diciembre al 1 de enero. Muestra aparte qué pasaría si el cierre comenzara al salir el 18 de diciembre y se reanudara el 4 de enero. Si la búsqueda completa falla o no hay publicaciones recientes, el monitor no inventa una fecha.
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

Cada entrada de `estimates` incluye `forecast`: promedio por día hábil, ritmos de 20 y 40 días, muestra usada, rango principal, rango con cierre extendido y fechas excluidas. Los cambios de estimación por sí solos no activan una alerta; los cambios reales en los registros o en los TP pendientes sí lo hacen.

Para probar la consulta localmente sin enviar Telegram, ejecuta:

```bash
TITLE_MONITOR_DRY_RUN=true node scripts/check-lagaceta-title.mjs
```

Para probar únicamente el cálculo sin consultar La Gaceta ni Telegram:

```bash
node --test scripts/*.test.mjs
```
