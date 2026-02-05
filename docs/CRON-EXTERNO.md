# Cron externo con parámetros en la URL

Una sola app en Railway queda levantada escuchando HTTP. Un **cron externo** (cron-job.org, EasyCron, etc.) llama a la URL con parámetros para ejecutar **prep** (8:30 Argentina) o **post N** (9:00, 11:00, 13:00, 15:00, 17:00, 19:00, 21:00 Argentina). No se usa Cron Schedule de Railway.

## Endpoint

**GET** `/run`

Query params:

- **token** (obligatorio): debe coincidir con la variable de entorno `CRON_SECRET`.
- **action**: `prep` o `post`.
- **index** (solo si `action=post`): 0, 1, 2, 3, 4, 5 o 6.

Ejemplos:

- Prep: `https://TU-APP.railway.app/run?token=TU_CRON_SECRET&action=prep`
- Post 0: `https://TU-APP.railway.app/run?token=TU_CRON_SECRET&action=post&index=0`

Reemplazá `TU_CRON_SECRET` por el valor que configuraste en Railway como `CRON_SECRET`. No dejes el secreto en la documentación pública.

**GET** `/` o **GET** `/health`: responde 200 OK (health check).

**Preview (dashboard):** al abrir la URL de tu app en el navegador verás el dashboard. Rutas útiles:
- **/** — página principal
- **/planificado** — planificación por fecha (posts del día desde Supabase)
- **/vista-previa** — vista previa de los posteos

## Horarios (Argentina = UTC−3)

Configurá 8 cron jobs en cron-job.org (o similar). Horario en **UTC**:

| # | Acción   | Hora Argentina | UTC (cron-job.org) | Parámetros URL              |
|---|----------|----------------|--------------------|-----------------------------|
| 1 | Prep     | 8:30           | 11:30              | `action=prep`               |
| 2 | Post 0   | 9:00           | 12:00              | `action=post&index=0`       |
| 3 | Post 1   | 11:00          | 14:00              | `action=post&index=1`       |
| 4 | Post 2   | 13:00          | 16:00              | `action=post&index=2`       |
| 5 | Post 3   | 15:00          | 18:00              | `action=post&index=3`       |
| 6 | Post 4   | 17:00          | 20:00              | `action=post&index=4`       |
| 7 | Post 5   | 19:00          | 22:00              | `action=post&index=5`       |
| 8 | Post 6   | 21:00          | 0:00 (día siguiente) | `action=post&index=6`     |

## Pasos en cron-job.org

1. Crear cuenta en [cron-job.org](https://cron-job.org).
2. Crear **8 cron jobs** (uno por fila de la tabla).
3. En cada uno:
   - **URL:** `https://TU-DOMINIO.railway.app/run?token=TU_CRON_SECRET&action=prep` (o `action=post&index=N`).
   - **Método:** GET.
   - **Schedule:** en UTC. Ejemplo para prep (8:30 Argentina = 11:30 UTC): minuto 30, hora 11, todos los días. Para post 0 (9:00 Argentina = 12:00 UTC): minuto 0, hora 12, todos los días. Y así con el resto según la tabla.
4. Guardar cada job.

## Variables de entorno (Railway)

- Las que ya usa el bot: Twitter, Supabase, S3, Gemini.
- **CRON_SECRET:** string secreto que usás en la URL; quien no lo sepa no puede disparar prep/post.

## Railway

- **Start command:** `node cron-server.js` (ya configurado en `railway.json` y Procfile).
- **Sin** Cron Schedule en Railway; la app corre como web service y solo hace trabajo cuando recibe GET /run con token y parámetros válidos.

## Pruebas locales

```bash
# Levantar el servidor de cron
node cron-server.js

# En otra terminal (reemplazá TU_SECRET por tu CRON_SECRET)
curl "http://localhost:3000/run?token=TU_SECRET&action=prep"
curl "http://localhost:3000/run?token=TU_SECRET&action=post&index=0"
```
