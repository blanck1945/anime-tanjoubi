/**
 * Resolución determinista de imagen para un personaje.
 * Una sola prioridad de fuentes y orden estable de resultados para que
 * prep y post-now (y cualquier flujo) obtengan SIEMPRE la misma imagen.
 *
 * Orden de fuentes (fijo):
 * 1. Anilist
 * 2. Safebooru (resultados ordenados por URL)
 * 3. Google Images (si configurado; resultados ordenados por URL)
 * 4. ACDB char.image (solo si hasAcdb y char tiene image)
 * 5. MAL (malChar.image_large || malChar.image)
 * 6. ACDB char.thumbnail (solo si hasAcdb y char tiene thumbnail)
 */

import path from 'path';
import fs from 'fs/promises';
import { getCharacterImage as getAnilistImage } from './anilist.js';
import { searchCharacterImages as searchSafebooruImages } from './safebooru.js';
import { searchImagesForCharacter, isGoogleImageSearchConfigured } from './google-image-search.js';
import { downloadImage } from './jikan.js';
import { validateImageFile, isUrlLikelyPlaceholder } from './image-validation.js';

function sanitizeFilename(name) {
  return String(name)
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 50);
}

/**
 * Orden estable para listas de resultados: por URL (localeCompare).
 * Así Safebooru y Google siempre dan el mismo "primer" candidato.
 */
function sortByUrl(items) {
  return [...items].sort((a, b) => (a.url || '').localeCompare(b.url || ''));
}

/**
 * Resuelve la imagen para un personaje con prioridad fija y orden determinista.
 *
 * @param {object} char - { name, series, image?, thumbnail? } (image/thumbnail solo si viene del scraper ACDB)
 * @param {object|null} malChar - resultado de searchCharacter (name, image, image_large, ...)
 * @param {string} tempDir - directorio para archivos temporales
 * @param {object} options - { hasAcdb: boolean, logSource?: boolean }
 * @returns {Promise<{ imagePath: string|null, source: string|null }>}
 */
export async function resolveImageForCharacter(char, malChar, tempDir, options = {}) {
  const { hasAcdb = false, logSource = false } = options;
  const displayName = malChar?.name || char.name;
  const baseName = sanitizeFilename(char.name);

  const tryDownload = async (url, label) => {
    if (!url) return null;
    const ext = url.includes('.png') ? '.png' : '.jpg';
    const imageFile = path.join(tempDir, `${baseName}_${label}${ext}`);
    const downloaded = await downloadImage(url, imageFile);
    if (!downloaded) return null;
    const validation = await validateImageFile(downloaded, displayName, char.series);
    if (!validation.valid) {
      try { await fs.unlink(downloaded); } catch (_) {}
      return null;
    }
    return downloaded;
  };

  // 1. Anilist
  const anilistResult = await getAnilistImage(char.name, char.series);
  if (anilistResult?.url) {
    const imagePath = await tryDownload(anilistResult.url, 'anilist');
    if (imagePath) {
      if (logSource) console.log('  [image-resolver] Using Anilist');
      return { imagePath, source: 'anilist' };
    }
  }

  // 2. Safebooru — orden estable por URL
  const safebooruResults = sortByUrl(await searchSafebooruImages(char.name, char.series, 5));
  for (let i = 0; i < safebooruResults.length; i++) {
    const result = safebooruResults[i];
    const imagePath = await tryDownload(result.url, `safebooru_${i}`);
    if (imagePath) {
      if (logSource) console.log('  [image-resolver] Using Safebooru');
      return { imagePath, source: 'safebooru' };
    }
    await new Promise(r => setTimeout(r, 200));
  }

  // 3. Google Images (si configurado) — orden estable por URL
  if (isGoogleImageSearchConfigured()) {
    const googleResults = sortByUrl(await searchImagesForCharacter(char.name, char.series, { num: 5, imgSize: 'large' }));
    for (let i = 0; i < googleResults.length; i++) {
      const result = googleResults[i];
      const imagePath = await tryDownload(result.url, `google_${i}`);
      if (imagePath) {
        if (logSource) console.log('  [image-resolver] Using Google Images');
        return { imagePath, source: 'google' };
      }
      await new Promise(r => setTimeout(r, 200));
    }
  }

  // 4. ACDB char.image
  if (hasAcdb && char.image && !isUrlLikelyPlaceholder(char.image)) {
    const imagePath = await tryDownload(char.image, 'acdb');
    if (imagePath) {
      if (logSource) console.log('  [image-resolver] Using ACDB image');
      return { imagePath, source: 'acdb' };
    }
  }

  // 5. MAL
  const malImageUrl = malChar?.image_large || malChar?.image;
  if (malImageUrl && malImageUrl !== 'undefined') {
    const imagePath = await tryDownload(malImageUrl, 'mal');
    if (imagePath) {
      if (logSource) console.log('  [image-resolver] Using MAL');
      return { imagePath, source: 'mal' };
    }
  }

  // 6. ACDB char.thumbnail
  if (hasAcdb && char.thumbnail && !isUrlLikelyPlaceholder(char.thumbnail)) {
    const imagePath = await tryDownload(char.thumbnail, 'acdb_thumb');
    if (imagePath) {
      if (logSource) console.log('  [image-resolver] Using ACDB thumbnail');
      return { imagePath, source: 'acdb_thumb' };
    }
  }

  return { imagePath: null, source: null };
}

export default { resolveImageForCharacter };
