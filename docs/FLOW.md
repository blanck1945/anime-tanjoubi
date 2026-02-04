# Flujo del Anime Birthday Bot

Guía de cómo funciona el bot y qué reglas aplica. **No usa MCP ni tools**; todo es lógica en código. Si más adelante se integra un agente con MCP, esta doc sirve como “qué debe hacer”.

---

## 1. Origen de datos: fecha y personajes

- **Fecha:** Se usa la **fecha local** (no `?today` del servidor) para evitar desfase por timezone.
- **URL ACDB:** `birthdays.php?theday=DD&themonth=Month` (ej. `theday=4&themonth=February`).
- **Personajes:** Top N por favoritos en la página del día (por defecto 6).
- **Serie en ACDB:** Puede ser incorrecta; se corrige con MAL cuando hay match.

---

## 2. Búsqueda de personaje en MAL (Jikan)

Objetivo: **personaje correcto + serie correcta** (evitar otro anime).

### Strategy 1 – Lista del anime (prioritaria)

1. Buscar anime por nombre de serie (ej. "Bleach", "Nura: Rise of the Yokai Clan").
2. Obtener lista de personajes de ese anime.
3. **Comparar nombres normalizados:**
   - MAL usa formato `"Last, First"` (ej. `Tsukishima, Shuukurou`).
   - Se convierte a `"First Last"` y se normaliza (quitar acentos, macrones, duplicar letras: `uu` → `u`).
   - Así "Shukuro Tsukishima" hace match con "Tsukishima, Shuukurou".
4. Si hay match → se usa **ese** personaje y **el título del anime en MAL** como serie (no el de ACDB).

### Strategy 2 – Búsqueda global

1. Si en Strategy 1 no hay match (ej. ACDB puso serie equivocada), se busca por nombre de personaje en MAL.
2. **Regla:** Se exige **buen match de nombre** (exacto o parcial normalizado).
3. Entre los que hacen match de nombre, se prefiere el que tenga la serie de ACDB en su lista de anime; si ninguno la tiene, se toma el mejor match de nombre y se usa **su** primer anime como serie.
4. Así no se fuerza una serie errónea de ACDB (ej. Asajigahara no Kijo → Nura, no Bleach).

### Uso de la serie en el post

- **Siempre que haya resultado de MAL:** `seriesForTweet = malChar.anime[0].title` (tras reordenar para poner primero el anime que coincida con la serie buscada).
- Si no hay MAL: se usa la serie que venga de ACDB.

---

## 3. Imágenes

### Prioridad de fuentes (en `preparePostsWithImages`)

1. **Anilist** – Imagen oficial del personaje.
2. **Safebooru** – Por tags (personaje + serie).
3. **Google Images** – Solo si está configurado.
4. **ACDB** – Imagen de la ficha (evitar placeholders).
5. **MAL** – Imagen del personaje (preferir `image_large`).
6. **ACDB thumbnail** – Último recurso.

### Calidad en vista previa

- En `download-preview-images.js`: se convierte URL de **miniatura** ACDB a **tamaño completo** (quitar `/thumbs/200/` en la ruta).
- Si la URL de tamaño completo devuelve 404, se usa la miniatura como respaldo.

### Personaje correcto (evitar otro anime)

- En `upgrade-preview-image.js` (y lógica equivalente en flujo principal): para imagen desde MAL se usa la **lista de personajes del anime** (Strategy 1), con los mismos criterios de **normalización de nombre** (MAL "Last, First", doble letra, etc.), para no tomar la imagen de otro personaje con nombre parecido.

---

## 4. Scripts útiles

| Script | Uso |
|--------|-----|
| `npm run build-preview` | Prepara top 6 de una fecha (imágenes + estado + preview). |
| `node scripts/download-preview-images.js YYYY-MM-DD` | Descarga/actualiza solo imágenes de vista previa (tamaño completo ACDB). |
| `node scripts/upgrade-preview-image.js YYYY-MM-DD índice [índice...]` | Busca imagen de mejor calidad para posts concretos (Anilist → MAL lista anime → MAL global → Safebooru). |
| `node scripts/list-birthdays.js` | Lista todos los personajes del día (solo lista, sin detalles). |

---

## 5. Textos y hashtags

- **Si está configurado `GOOGLE_GEMINI_API_KEY`:** Se usa **Gemini** (modelo `gemini-2.0-flash`) para generar el mensaje del tweet: 1–2 frases + 5–8 hashtags relevantes (serie, personaje, anime, cumpleaños), máximo 280 caracteres, en inglés, sin spoilers ni datos inventados. El prompt incluye nombre, serie, fecha de cumpleaños y, si hay, descripción corta (`about`) y géneros.
- **Si no está configurado o Gemini falla** (timeout, error de API, respuesta vacía o inválida): se usa la **plantilla fija** `createBirthdayMessage(character)` en `src/twitter.js`.
- La función unificada es `getBirthdayMessage(character)` (async): intenta Gemini primero y hace fallback a la plantilla. Se usa en el post real y en la vista previa (`index.js`, `scripts/build-preview.js`).

---

## 6. MCP / Tools

- **Hoy:** El bot **no** usa MCP ni tools; las decisiones están en código (scraper, jikan, anilist, safebooru, index.js).
- **Posible extensión:** Un agente con MCP podría usar esta doc como “reglas” y exponer herramientas como: “obtener cumpleaños de una fecha”, “buscar personaje en MAL con serie”, “descargar imagen de vista previa para un índice”, etc. Esa capa no está implementada aún.
