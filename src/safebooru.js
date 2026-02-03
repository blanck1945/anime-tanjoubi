/**
 * Safebooru API — imágenes de anime por tags (personaje + serie).
 * Sin API key. SFW. Docs: https://safebooru.org/index.php?page=help&topic=dapi
 */

import axios from 'axios';

const SAFEBOORU_API = 'https://safebooru.org/index.php';

/**
 * Convierte nombre/serie a tags para Safebooru (espacios → guión bajo, sin caracteres raros).
 */
function toTag(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^\w\-_]/g, '')
    .toLowerCase()
    .slice(0, 50);
}

/**
 * Busca imágenes por personaje y serie. Devuelve URLs de imágenes en tamaño completo.
 * @param {string} characterName
 * @param {string} series
 * @param {number} limit - máx. resultados
 * @returns {Promise<{ url: string }[]>}
 */
export async function searchCharacterImages(characterName, series, limit = 5) {
  const charTag = toTag(characterName);
  const seriesTag = toTag(series);
  const tags = [charTag, seriesTag].filter(Boolean).join(' ');

  if (!tags) return [];

  try {
    const response = await axios.get(SAFEBOORU_API, {
      params: {
        page: 'dapi',
        s: 'post',
        q: 'index',
        tags,
        limit: Math.min(limit, 10),
        json: 1
      },
      timeout: 10000
    });

    const data = response.data;
    const posts = Array.isArray(data) ? data : [];

    return posts
      .filter(p => p.file_url)
      .map(p => ({
        url: p.file_url.startsWith('http') ? p.file_url : `https:${p.file_url}`
      }))
      .slice(0, limit);
  } catch (error) {
    console.warn('[Safebooru] Error:', error.message);
    return [];
  }
}

export default { searchCharacterImages };
