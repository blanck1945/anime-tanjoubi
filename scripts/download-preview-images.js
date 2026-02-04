/**
 * Descarga solo las imágenes de vista previa para una fecha (desde ACDB).
 * Usa la lista del día (1 request), convierte thumbs a tamaño completo y descarga. Rápido.
 *
 * Uso: node scripts/download-preview-images.js [YYYY-MM-DD]
 * Ejemplo: node scripts/download-preview-images.js 2026-02-04
 */

import path from 'path';
import fs from 'fs/promises';
import axios from 'axios';
import { fileURLToPath } from 'url';
import { getTodaysBirthdaysListOnly } from '../src/scraper.js';
import { DATA_DIR } from '../src/state.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** ACDB: convertir miniatura (thumbs/200) a imagen en tamaño completo */
function thumbnailToFullUrl(url) {
  if (!url) return url;
  // uploads/chars/thumbs/200/123-456.jpg → uploads/chars/123-456.jpg
  if (url.includes('/thumbs/200/')) return url.replace('/thumbs/200/', '/');
  // uploads/thumbs/123-456.jpg → uploads/123-456.jpg
  if (url.includes('/thumbs/')) return url.replace('/thumbs/', '/');
  return url;
}

/** ACDB a veces devuelve URLs con espacios; extraemos la parte uploads/... */
function fixImageUrl(url) {
  if (!url) return null;
  const match = url.match(/uploads\/[^\s]+\.(jpg|jpeg|png|gif)/i);
  if (match) return `https://ami.animecharactersdatabase.com/${match[0]}`;
  return url.includes(' ') ? url.replace(/ /g, '%20') : url;
}

async function downloadImage(imageUrl, outputPath) {
  const url = fixImageUrl(imageUrl);
  if (!url) return false;
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.animecharactersdatabase.com/'
      }
    });
    await fs.writeFile(outputPath, response.data);
    return true;
  } catch (err) {
    console.warn(`  No se pudo descargar: ${err.message}`);
    return false;
  }
}

async function main() {
  const dateStr = process.argv[2] || '2026-02-04';
  const statePath = path.join(DATA_DIR, `posts-${dateStr}.json`);
  const previewDir = path.join(DATA_DIR, 'preview', dateStr);

  let state;
  try {
    const raw = await fs.readFile(statePath, 'utf-8');
    state = JSON.parse(raw);
  } catch (e) {
    console.error(`No existe estado para ${dateStr}. Ejecutá primero build-preview o creá posts-${dateStr}.json`);
    process.exit(1);
  }

  if (!state.posts || state.posts.length === 0) {
    console.error('No hay posts en el estado.');
    process.exit(1);
  }

  const date = new Date(dateStr + 'T12:00:00');
  console.log(`Obteniendo lista del ${dateStr}...`);
  const list = await getTodaysBirthdaysListOnly(date);
  const byId = new Map(list.map(c => [c.id, c]));

  await fs.mkdir(previewDir, { recursive: true });
  console.log(`Descargando ${state.posts.length} imágenes para ${dateStr}...\n`);

  for (let i = 0; i < state.posts.length; i++) {
    const post = state.posts[i];
    const acdbId = post.acdbId;
    const name = post.character;
    const char = byId.get(acdbId);
    const thumbUrl = char?.thumbnail || char?.image;
    const fullUrl = fixImageUrl(thumbnailToFullUrl(thumbUrl));
    if (!fullUrl) {
      console.log(`  [${i}] ${name}: sin imagen en lista`);
      continue;
    }
    console.log(`  [${i}] ${name}...`);
    const dest = path.join(previewDir, `${i}.jpg`);
    let ok = await downloadImage(fullUrl, dest);
    if (!ok && thumbUrl && thumbUrl !== fullUrl) {
      const thumbFixed = fixImageUrl(thumbUrl);
      if (thumbFixed) {
        console.log(`      (full 404, usando miniatura)`);
        ok = await downloadImage(thumbFixed, dest);
      }
    }
    console.log(ok ? `      OK ${path.basename(dest)}` : `      Falló`);
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\nListo. Vista previa: http://127.0.0.1:3000/vista-previa?date=${dateStr}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
