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
