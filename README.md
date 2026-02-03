# Anime Birthday Bot

Bot que publica automáticamente cumpleaños de personajes de anime en Twitter/X.

## Características

- Obtiene los personajes de anime que cumplen años hoy desde [AnimeCharactersDatabase](https://www.animecharactersdatabase.com)
- Busca imágenes HD en MyAnimeList via [Jikan API](https://jikan.moe)
- Publica 5 tweets diarios a las 9:00, 12:00, 15:00, 18:00 y 21:00 (hora Argentina)
- Incluye nombre en kanji y hashtags relevantes

## Instalación

```bash
cd anime-birthday-bot
npm install
```

## Configuración

Crea un archivo `.env` con tus credenciales de Twitter:

```env
API_KEY=tu_api_key
API_SECRET=tu_api_secret
ACCESS_TOKEN=tu_access_token
ACCESS_TOKEN_SECRET=tu_access_token_secret
```

## Uso

### Dry Run (sin postear)
```bash
npm run dry-run
```

### Postear ahora (manual)
```bash
# Postear 1 personaje
npm run post-now

# Postear 3 personajes
node scripts/post-now.js 3

# Postear 5 personajes con 60s de delay
node scripts/post-now.js 5 --delay=60
```

### Ejecutar el bot (modo scheduler)
```bash
npm start
```

### Ejecutar inmediatamente todos los posts
```bash
node index.js --now
```

## Configurar Task Scheduler (Windows)

Ejecuta como Administrador:
```bash
scripts\setup-scheduler.bat
```

Esto creará una tarea que ejecuta el bot diariamente a las 8:30 AM (Argentina).

## Despliegue en Railway

Para que el bot **no pierda el historial de posteos** al hacer deploy (y no vuelva a scrapear personajes nuevos), es necesario usar un **volumen persistente**:

1. En tu proyecto de Railway, ve al servicio del bot.
2. Abre **Variables** o **Settings** y en **Volumes** agrega un volumen.
3. Monta el volumen en la ruta: **`/data`**.

Así los archivos `posts-YYYY-MM-DD.json` se guardan en ese volumen y sobreviven a cada deploy. Si no configurás `/data`, cada deploy arranca con estado vacío y el bot puede marcar todo como no publicado y tomar otra lista de personajes.

### Cómo verificar que el estado persiste

1. **Logs al arrancar**  
   En Railway → tu servicio → **Deployments** → **View Logs**. Buscá:
   - `[State] Using data directory: /data (Railway: true)` → está usando el directorio correcto.
   - `[State check] canRecoverFromState: true | state exists: true | ...` → hay estado de hoy y se va a recuperar (no re-scrape).
   - `[Recovery] Recovering today's posts from state...` → entró por recuperación.
   - `[Scrape] No recovery: fetching today's birthdays...` → no había estado, scrapea de nuevo.

2. **Endpoint de diagnóstico**  
   Abrí en el navegador (o con `curl`):
   ```
   https://tu-app.railway.app/api/state-check
   ```
   Ahí ves:
   - `dataDir`, `dataDirExists`, `dataDirWritable`: si `/data` existe y se puede escribir (si no, el volumen no está bien montado).
   - `stateExists`, `canRecoverFromState`, `reason`: por qué se recupera o no.
   - `filesInData`: archivos en `/data` (deberían aparecer `posts-YYYY-MM-DD.json` después del primer día).

Si `dataDirExists` es `false` o `dataDirWritable` es `false`, el volumen en Railway no está configurado o no está montado en `/data`.

## Estructura

```
anime-birthday-bot/
├── index.js              # Entry point principal
├── src/
│   ├── scraper.js        # Scraping de cumpleaños
│   ├── jikan.js          # API de MyAnimeList
│   ├── twitter.js        # Publicación en Twitter
│   └── scheduler.js      # Programación de posts
├── scripts/
│   ├── dry-run.js        # Test sin postear
│   ├── post-now.js       # Posteo manual
│   └── setup-scheduler.bat
└── temp/                 # Imágenes temporales
```

## Horarios de posteo

| # | Hora (Argentina) | UTC |
|---|------------------|-----|
| 1 | 09:00 | 12:00 |
| 2 | 12:00 | 15:00 |
| 3 | 15:00 | 18:00 |
| 4 | 18:00 | 21:00 |
| 5 | 21:00 | 00:00 |

## Futuro: Soporte para videos

El bot está diseñado para soportar videos en el futuro usando `yt-dlp`.
