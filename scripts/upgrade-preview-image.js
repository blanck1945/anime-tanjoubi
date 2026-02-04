/**
 * Busca imagen de mejor calidad para un post (Anilist → MAL → Safebooru) y la guarda en vista previa.
 *
 * Uso: node scripts/upgrade-preview-image.js [YYYY-MM-DD] [índice1] [índice2] ...
 * Ejemplo: node scripts/upgrade-preview-image.js 2026-02-04 2 4
 */

import 'dotenv/config';
import path from 'path';
import fs from 'fs/promises';
import axios from 'axios';
import { fileURLToPath } from 'url';
import { getCharacterImage as getAnilistImage } from '../src/anilist.js';
import { searchAnime, getAnimeCharacters, getCharacterById, searchCharacter, downloadImage as jikanDownload } from '../src/jikan.js';
import { searchCharacterImages as searchSafebooru } from '../src/safebooru.js';
import { validateImageFile } from '../src/image-validation.js';
import { DATA_DIR } from '../src/state.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function downloadGeneric(url, outputPath) {
  if (!url) return false;
  try {
    const res = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 20000,
      headers: { 'User-Agent': 'AnimeBirthdayBot/1.0' }
    });
    await fs.writeFile(outputPath, res.data);
    return true;
  } catch (e) {
    return false;
  }
}

/** Normalizar nombre para comparar (acentos, macrones, duplicados: ū→u, uu→u) */
function normalizeName(s) {
  if (!s || typeof s !== 'string') return '';
  let t = s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  t = t.replace(/(.)\1+/g, '$1');
  return t;
}

/** MAL usa "Last, First"; convertir a "First Last" para comparar */
function malNameToFirstLast(name) {
  if (!name || !name.includes(',')) return name;
  const [last, ...firstParts] = name.split(',').map(s => s.trim());
  const first = firstParts.join(' ').trim();
  return first ? `${first} ${last}` : last;
}

async function findBetterImage(name, series, tempDir) {
  const base = path.join(tempDir, name.replace(/[^\w\s]/g, '').replace(/\s+/g, '_').slice(0, 30));

  // 0. MAL: personaje exacto del anime (lista de personajes de la serie → evita otro anime)
  const anime = await searchAnime(series);
  if (anime?.mal_id) {
    const chars = await getAnimeCharacters(anime.mal_id);
    const nameNorm = normalizeName(name);
    const nameParts = nameNorm.split(/\s+/).filter(Boolean);
    for (const entry of chars) {
      const malNameRaw = (entry.character?.name || '').trim();
      const malNameFirstLast = malNameToFirstLast(malNameRaw);
      const charNorm = normalizeName(malNameFirstLast);
      const exact = charNorm === nameNorm;
      const partial = nameParts.length >= 2 && nameParts.every(p => charNorm.includes(p));
      if (exact || partial) {
        const malId = entry.character?.mal_id;
        const images = entry.character?.images?.jpg;
        const imgUrl = images?.large_image_url || images?.image_url;
        if (malId && imgUrl && !imgUrl.includes('apple-touch-icon')) {
          const file = `${base}_mal_anime.jpg`;
          const ok = await jikanDownload(imgUrl, file);
          if (ok) {
            const stat = await fs.stat(file).catch(() => null);
            if (stat && stat.size > 25000) return file;
            await fs.unlink(file).catch(() => {});
          }
        }
        break;
      }
    }
    await new Promise(r => setTimeout(r, 400));
  }

  // 1. Anilist (buena calidad, oficial); si no hay, probar solo apellido
  let anilist = await getAnilistImage(name, series);
  if (!anilist?.url && name.includes(' ')) {
    const lastName = name.trim().split(/\s+/).pop();
    anilist = await getAnilistImage(lastName, series);
  }
  if (anilist?.url) {
    const file = `${base}_anilist.jpg`;
    if (await downloadGeneric(anilist.url, file)) {
      const v = await validateImageFile(file, name, series);
      if (v.valid) return file;
      const stat = await fs.stat(file).catch(() => null);
      if (stat && stat.size > 25000) return file;
      await fs.unlink(file).catch(() => {});
    }
  }

  // 2. MAL búsqueda global (ya intentamos lista del anime en paso 0)
  const mal = await searchCharacter(name, series);
  const malUrl = mal?.image_large || mal?.image;
  const malName = (mal?.name || '').toLowerCase();
  const malAnime = (mal?.anime || []).map(a => (a?.title || '').toLowerCase()).join(' ');
  const nameWords = name.toLowerCase().split(/\s+/).filter(w => w.length > 1);
  const seriesLower = (series || '').toLowerCase();
  const nameMatch = nameWords.some(w => malName.includes(w));
  const seriesMatch = seriesLower && malAnime.includes(seriesLower.split(' ')[0]);
  if (malUrl && !malUrl.includes('apple-touch-icon') && (nameMatch || seriesMatch)) {
    const file = `${base}_mal.jpg`;
    const ok = await jikanDownload(malUrl, file);
    if (ok) {
      const stat = await fs.stat(file).catch(() => null);
      const v = await validateImageFile(file, name, series);
      if (v.valid) return file;
      if (stat && stat.size > 25000) return file;
      await fs.unlink(file).catch(() => {});
    }
  }

  // 3. Safebooru (nombre completo y, si no hay, apellido + serie)
  let safebooru = await searchSafebooru(name, series, 3);
  if (safebooru.length === 0 && name.includes(' ')) {
    const lastName = name.trim().split(/\s+/).pop();
    safebooru = await searchSafebooru(lastName, series, 3);
  }
  for (let i = 0; i < safebooru.length; i++) {
    const file = `${base}_safebooru_${i}.jpg`;
    if (await downloadGeneric(safebooru[i].url, file)) {
      const v = await validateImageFile(file, name, series);
      if (v.valid) return file;
      const stat = await fs.stat(file).catch(() => null);
      if (stat && stat.size > 25000) return file;
      await fs.unlink(file).catch(() => {});
    }
  }

  return null;
}

async function main() {
  const dateStr = process.argv[2] || '2026-02-04';
  const indices = process.argv.slice(3).map(s => parseInt(s, 10)).filter(n => !isNaN(n));
  if (indices.length === 0) {
    console.log('Uso: node scripts/upgrade-preview-image.js YYYY-MM-DD índice1 [índice2 ...]');
    console.log('Ejemplo: node scripts/upgrade-preview-image.js 2026-02-04 2 4');
    process.exit(1);
  }

  const statePath = path.join(DATA_DIR, `posts-${dateStr}.json`);
  const previewDir = path.join(DATA_DIR, 'preview', dateStr);
  const tempDir = path.join(path.dirname(__dirname), 'temp');

  let state;
  try {
    state = JSON.parse(await fs.readFile(statePath, 'utf-8'));
  } catch (e) {
    console.error('No existe estado para', dateStr);
    process.exit(1);
  }

  await fs.mkdir(tempDir, { recursive: true });
  await fs.mkdir(previewDir, { recursive: true });

  for (const idx of indices) {
    const post = state.posts?.[idx];
    if (!post) {
      console.log(`[${idx}] No existe post`);
      continue;
    }
    const name = post.character;
    const series = post.series;
    console.log(`[${idx}] ${name} (${series}) – buscando mejor imagen...`);
    const file = await findBetterImage(name, series, tempDir);
    if (file) {
      const dest = path.join(previewDir, `${idx}.jpg`);
      await fs.copyFile(file, dest);
      try { await fs.unlink(file); } catch (_) {}
      console.log(`      Guardado: ${dest}`);
    } else {
      console.log(`      No se encontró imagen de mejor calidad`);
    }
    await new Promise(r => setTimeout(r, 500));
  }

  console.log('\nListo. Refrescá: http://127.0.0.1:3000/vista-previa?date=' + dateStr);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
