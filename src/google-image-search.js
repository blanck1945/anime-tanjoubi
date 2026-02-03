/**
 * Búsqueda de imágenes vía Google Custom Search API.
 * Fuente más consistente y de mejor calidad cuando ACDB/MAL fallan o dan baja calidad.
 *
 * Requiere: GOOGLE_API_KEY y GOOGLE_CSE_ID en .env
 * - API key: https://console.cloud.google.com/apis/credentials
 * - CSE ID: https://programmablesearchengine.google.com/ (crear motor, buscar "todo el web", activar búsqueda de imágenes)
 * - Cuota gratuita: 100 búsquedas/día
 */

import axios from 'axios';

const BASE_URL = 'https://www.googleapis.com/customsearch/v1';

/**
 * Indica si Google Image Search está configurado
 */
export function isGoogleImageSearchConfigured() {
  return !!(process.env.GOOGLE_API_KEY && process.env.GOOGLE_CSE_ID);
}

/**
 * Busca imágenes en Google para un personaje/serie.
 * @param {string} characterName - nombre del personaje
 * @param {string} series - nombre de la serie/anime
 * @param {object} options - { num: 5, imgSize: 'large'|'xlarge'|'huge' }
 * @returns {Promise<{ url: string, width?: number, height?: number }[]>}
 */
export async function searchImagesForCharacter(characterName, series, options = {}) {
  const apiKey = process.env.GOOGLE_API_KEY;
  const cx = process.env.GOOGLE_CSE_ID;
  if (!apiKey || !cx) {
    return [];
  }

  const num = Math.min(options.num ?? 5, 10);
  const imgSize = options.imgSize || 'large'; // large, xlarge, huge para mejor calidad

  const query = `${characterName} ${series} anime character`.replace(/\s+/g, ' ').trim();
  if (!query) return [];

  try {
    const response = await axios.get(BASE_URL, {
      params: {
        key: apiKey,
        cx,
        q: query,
        searchType: 'image',
        num,
        imgSize,
        safe: 'active'
      },
      timeout: 15000
    });

    const items = response.data?.items || [];
    return items
      .filter(item => item.link && (item.link.startsWith('http://') || item.link.startsWith('https://')))
      .map(item => ({
        url: item.link,
        width: item.image?.width ? parseInt(item.image.width, 10) : undefined,
        height: item.image?.height ? parseInt(item.image.height, 10) : undefined
      }));
  } catch (error) {
    if (error.response?.status === 429) {
      console.warn('[Google Image Search] Cuota diaria posiblemente agotada (429)');
    } else {
      console.warn('[Google Image Search] Error:', error.message);
    }
    return [];
  }
}

export default {
  isGoogleImageSearchConfigured,
  searchImagesForCharacter
};
