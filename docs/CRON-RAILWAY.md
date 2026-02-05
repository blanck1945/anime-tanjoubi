# Railway Cron — 1 solo Cron Schedule

Railway solo permite **un Cron Schedule por servicio**. Con **un solo cron** (cada 30 min) el script mira la hora en **Argentina** y hace prep o post N si cae en esa ventana; si no, sale sin hacer nada. **No hace falta** configurar `CRON_ACTION` ni `CRON_POST_INDEX`.

## Configuración (1 solo cron)

1. En tu **servicio** → **Settings** → **Cron Schedule**.
2. **Tipo:** Custom (o el que permita expresión cron).
3. **Expresión (UTC):** por ejemplo:
   - Cada 30 min (recomendado para no perder ninguna ventana): `*/30 * * * *`
   - Cada 2 horas: `0 */2 * * *`
   (Railway exige al menos 5 min entre ejecuciones.)
4. **Variables:** solo las del bot (Twitter, Supabase, S3, Gemini). **No** hace falta `CRON_ACTION` ni `CRON_POST_INDEX`.

El script corre cada 30 min; mira la hora en Argentina y solo actúa en estas ventanas:

| Ventana Argentina | Acción |
|-------------------|--------|
| 8:30 – 8:59       | Prep   |
| 9:00 – 9:29       | Post 0 |
| 10:30 – 10:59     | Post 1 |
| 12:00 – 12:29     | Post 2 |
| 15:00 – 15:29     | Post 3 |
| 18:00 – 18:29     | Post 4 |
| 21:00 – 21:29     | Post 5 |

Fuera de esas ventanas, el proceso sale sin hacer nada.

## Variables de entorno (Railway)

- **Twitter:** `API_KEY`, `API_SECRET`, `ACCESS_TOKEN`, `ACCESS_TOKEN_SECRET`
- **Supabase:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- **S3:** `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `S3_BUCKET`
- **Gemini (opcional):** `GOOGLE_GEMINI_API_KEY`

## Pruebas locales

```bash
make prep          # Preparar día
make post          # Post índice 0
make post N=1      # Post índice 1
```
