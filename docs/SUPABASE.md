# Supabase — base de datos para el bot

El bot guarda el estado del día (posts programados/publicados) en Supabase (PostgreSQL).

## 1. Crear proyecto en Supabase

1. [Supabase](https://supabase.com) → **New project**.
2. Elegí organización, nombre del proyecto y contraseña de la base de datos.
3. En **Settings** → **API** tenés:
   - **Project URL** → `SUPABASE_URL`
   - **service_role** (secret) → `SUPABASE_SERVICE_ROLE_KEY` (solo en servidor, nunca en el cliente)

## 2. Crear la tabla (una fila por post)

En el **SQL Editor** del proyecto, ejecutá:

```sql
-- Si tenés la tabla antigua (una fila por fecha), borrala primero:
-- drop table if exists public.daily_posts;

create table if not exists public.daily_posts (
  date text not null,
  post_index int not null,
  character text not null,
  series text,
  scheduled_time text,
  preview_text text,
  image_url text,
  status text default 'pending',
  posted_at timestamptz,
  tweet_url text,
  error text,
  prepared_at timestamptz default now(),
  primary key (date, post_index)
);

comment on table public.daily_posts is 'Una fila por post. Filtrar por date para ver todos los posteos del día.';
```

## 3. Variables de entorno

**Bot (raíz del proyecto, `.env`):**

| Variable | Valor |
|----------|--------|
| `SUPABASE_URL` | Project URL (ej. https://xxxx.supabase.co) |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key (Settings → API) |

**Frontend (`frontend/.env.local`):** las mismas (las API routes son server-side y pueden usar service_role para leer).

## 4. Comprobar

```bash
node scripts/check-supabase.js
```

Después de correr `node index.js --prep` deberías ver fechas y posts en Supabase (Table Editor → `daily_posts`). Para probar el flujo con 1 solo personaje: `node index.js --prep --limit=1` o `npm run prep:test`.
