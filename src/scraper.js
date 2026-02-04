import axios from 'axios';
import * as cheerio from 'cheerio';
import { isUrlLikelyPlaceholder } from './image-validation.js';

const BIRTHDAYS_BASE = 'https://www.animecharactersdatabase.com/birthdays.php';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

/**
 * URL de cumpleaños para una fecha concreta (evita que el servidor use su timezone y devuelva el día anterior).
 * @param {Date} [date] - Fecha a usar; por defecto hoy (local).
 */
function getBirthdaysUrl(date = new Date()) {
  const day = date.getDate();
  const month = MONTH_NAMES[date.getMonth()];
  return `${BIRTHDAYS_BASE}?theday=${day}&themonth=${encodeURIComponent(month)}`;
}

/**
 * CÓMO VIENE LA DATA DE ACDB (Anime Characters Database)
 *
 * Hay dos niveles de scraping:
 *
 * 1) Página de cumpleaños del día (birthdays.php?today)
 *    - Solo lista de personajes: id, name (alt/thumbnail), thumbnail, url.
 *    - NO hay favoritos en esta página; el orden es el del HTML, no por popularidad.
 *
 * 2) Ficha del personaje (characters.php?id=X) — getCharacterDetails(charId)
 *    - Por cada personaje se hace una petición y se extrae: name, series, image, favorites, birthday.
 *    - Los favoritos se obtienen con un regex sobre el texto del body (ver comentario en getCharacterDetails).
 *
 * Flujo: lista del día (con favoritos "X favorites" por tarjeta) → ordenar por favorites desc → getCharacterDetails solo para top 6.
 */

/**
 * Scrape today's birthday characters from animecharactersdatabase.com.
 * Returns the top N characters by favorites (más populares primero).
 * Los favoritos se extraen de la página del día (❤️X favorites) para ordenar correctamente.
 */
export async function getTodaysBirthdays(limit = 6, date = new Date()) {
  try {
    const url = getBirthdaysUrl(date);
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const $ = cheerio.load(response.data);
    const characters = [];

    // En la página del día ACDB muestra "❤️55 favorites" en cada tarjeta (mismo orden que los links).
    const bodyText = $('body').text();
    const favNumbers = [...bodyText.matchAll(/(\d+)\s*favorites?\b/gi)].map(m => parseInt(m[1], 10));
    let favIndex = 0;

    // Parse character cards from the page
    $('a[href*="characters.php"]').each((i, elem) => {
      const $elem = $(elem);
      const href = $elem.attr('href');

      if (!href || !href.includes('id=')) return;

      const $img = $elem.find('img');
      const imgSrc = $img.attr('src') || $img.attr('data-src');
      const alt = $img.attr('alt') || '';

      const $parent = $elem.parent();
      const text = $parent.text().trim();

      const idMatch = href.match(/id=(\d+)/);
      const charId = idMatch ? idMatch[1] : null;

      if (charId && imgSrc) {
        // Asignar favoritos por orden de tarjeta: el n-ésimo personaje recibe el n-ésimo "X favorites".
        const favorites = favIndex < favNumbers.length ? favNumbers[favIndex++] : 0;
        characters.push({
          id: charId,
          name: alt || text.split('\n')[0]?.trim() || 'Unknown',
          thumbnail: imgSrc.startsWith('http') ? imgSrc : `https://www.animecharactersdatabase.com${imgSrc}`,
          url: `https://www.animecharactersdatabase.com${href}`,
          favorites
        });
      }
    });

    // Quitar duplicados por ID (se mantiene la primera aparición, que tiene el orden correcto).
    const uniqueChars = [...new Map(characters.map(c => [c.id, c])).values()];

    // Ordenar por favoritos (más populares primero) usando los datos de la página del día.
    uniqueChars.sort((a, b) => (b.favorites ?? 0) - (a.favorites ?? 0));

    // Solo pedir detalles (nombre, serie, imagen) para los top N que vamos a publicar.
    const topChars = uniqueChars.slice(0, limit);
    const detailedChars = [];
    for (const char of topChars) {
      try {
        const details = await getCharacterDetails(char.id);
        if (details) {
          detailedChars.push({
            ...char,
            ...details,
            favorites: char.favorites ?? details.favorites ?? 0
          });
        } else {
          detailedChars.push({ ...char, series: 'Unknown Anime', birthday: formatTodaysBirthday(), image: null });
        }
        await sleep(300);
      } catch (e) {
        console.error(`Failed to get details for ${char.name}:`, e.message);
        detailedChars.push({ ...char, series: 'Unknown Anime', birthday: formatTodaysBirthday(), image: null });
      }
    }

    console.log(`[DEBUG] Top ${limit} por favoritos (página del día):`,
      detailedChars.map(c => `${c.name} (${c.favorites ?? 0} favs)`).join(', '));

    return detailedChars;
  } catch (error) {
    console.error('Error scraping birthdays:', error.message);
    throw error;
  }
}

/**
 * Ficha del personaje en ACDB (nivel 2).
 * URL: characters.php?id={charId}
 * Extrae: name (h1/title), series (source.php/breadcrumb), image (uploads/thumbs), favorites (regex en body), birthday (hoy).
 */
async function getCharacterDetails(charId) {
  try {
    const url = `https://www.animecharactersdatabase.com/characters.php?id=${charId}`;
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const $ = cheerio.load(response.data);

    // Extract character name
    const name = $('h1').first().text().trim() ||
                 $('title').text().split(' - ')[0]?.trim() ||
                 'Unknown Character';

    // Extract anime/series name
    let series = '';
    $('a[href*="source.php"]').each((i, elem) => {
      const text = $(elem).text().trim();
      if (text && text.length > 2) {
        series = text;
        return false; // Break loop
      }
    });

    // Try alternative methods to find series
    if (!series) {
      const breadcrumb = $('.breadcrumb, .source-name, [class*="anime"]').text();
      if (breadcrumb) {
        series = breadcrumb.trim();
      }
    }

    // Extract character image - look for main character image
    let image = null;

    // Priority 1: Look for full-size images in uploads/ (not thumbs, not icons, not chars/thumbs)
    $('img').each((i, elem) => {
      const src = $(elem).attr('src') || $(elem).attr('data-src') || '';
      // Match uploads/*.jpg but NOT uploads/thumbs/ or uploads/chars/thumbs/
      if (src.includes('/uploads/') && !src.includes('/thumbs/') && !src.includes('/icons/') && src.match(/uploads\/[\d]+-[\d]+\.(jpg|png|gif)/i)) {
        image = src.startsWith('http') ? src : `https://ami.animecharactersdatabase.com${src}`;
        return false; // Break loop
      }
    });

    // Priority 2: Try uploads/chars/ full images
    if (!image) {
      $('img').each((i, elem) => {
        const src = $(elem).attr('src') || $(elem).attr('data-src') || '';
        if (src.includes('uploads/chars/') && !src.includes('thumbs/') && !src.includes('icons')) {
          image = src.startsWith('http') ? src : `https://ami.animecharactersdatabase.com${src}`;
          return false;
        }
      });
    }

    // Priority 3: Convert thumb URL to full image URL
    if (!image) {
      $('img').each((i, elem) => {
        const src = $(elem).attr('src') || $(elem).attr('data-src') || '';
        if (src.includes('/uploads/thumbs/') && src.match(/[\d]+-[\d]+\.(jpg|png|gif)/i)) {
          // From: .../uploads/thumbs/1234-567.jpg -> .../uploads/1234-567.jpg
          const fullUrl = src.replace('/uploads/thumbs/', '/uploads/');
          image = fullUrl.startsWith('http') ? fullUrl : `https://ami.animecharactersdatabase.com${fullUrl}`;
          return false;
        }
        if (src.includes('uploads/chars/thumbs/')) {
          // From: .../uploads/chars/thumbs/200/1234-567.jpg -> .../uploads/chars/1234-567.jpg
          const fullUrl = src.replace('/thumbs/200/', '/').replace('/thumbs/', '/');
          image = fullUrl.startsWith('http') ? fullUrl : `https://ami.animecharactersdatabase.com${fullUrl}`;
          return false;
        }
      });
    }
    
    if (image && isUrlLikelyPlaceholder(image)) {
      console.log(`  [DEBUG] ACDB image for ${cleanName(name)}: rejected (placeholder/generic URL)`);
      image = null;
    } else {
      console.log(`  [DEBUG] ACDB image for ${cleanName(name)}: ${image || 'not found'}`);
    }

    // Favoritos: en la ficha ACDB aparece "Fav 41" o "41 favorites". Tomamos el MÁXIMO.
    let favorites = 0;
    const pageText = $('body').text();
    const patterns = [
      /Fav\s*(\d+)/i,
      /(\d+)\s*(?:favorites?|likes?|tributes?)/gi,
      /(?:favorites?|likes?|tributes?)\s*:?\s*(\d+)/gi
    ];
    for (const re of patterns) {
      let match;
      while ((match = re.exec(pageText)) !== null) {
        const n = parseInt(match[1], 10);
        if (n > favorites) favorites = n;
      }
    }

    // Get today's date formatted as "Month Day"
    const birthday = formatTodaysBirthday();

    return {
      name: cleanName(name),
      series: series || 'Unknown Anime',
      favorites,
      birthday,
      image // Add image from ACDB
    };
  } catch (error) {
    console.error(`Error getting details for character ${charId}:`, error.message);
    return null;
  }
}

function cleanName(name) {
  return name
    .replace(/\s*\|.*$/g, '')    // Remove "| Wealth: X" etc
    .replace(/\s+/g, ' ')
    .replace(/\([^)]*\)/g, '')
    .trim();
}

/**
 * Format today's date as "Month Day" (e.g., "January 31")
 */
function formatTodaysBirthday() {
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const today = new Date();
  return `${months[today.getMonth()]} ${today.getDate()}`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Get character details by ACDB id (for recovery from state without re-scraping the list)
 */
export async function getCharacterDetailsById(charId) {
  return getCharacterDetails(charId);
}

/**
 * Solo lista del día (sin abrir fichas). Un solo request.
 * @returns {Promise<Array<{ id: string, name: string, thumbnail: string, url: string, favorites: number }>>}
 */
export async function getTodaysBirthdaysListOnly(date = new Date()) {
  try {
    const url = getBirthdaysUrl(date);
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const $ = cheerio.load(response.data);
    const byId = new Map();
    const bodyText = $('body').text();
    const favNumbers = [...bodyText.matchAll(/(\d+)\s*favorites?\b/gi)].map(m => parseInt(m[1], 10));
    let favIndex = 0;

    $('a[href*="characters.php"]').each((i, elem) => {
      const $elem = $(elem);
      let href = $elem.attr('href') || '';
      const idMatch = href.match(/id=(\d+)/);
      const charId = idMatch ? idMatch[1] : null;
      if (!charId) return;

      const canonicalUrl = `https://www.animecharactersdatabase.com/characters.php?id=${charId}`;

      if (href.includes('facebook.com') || href.includes('sharer')) {
        let name = 'Unknown';
        const quoteMatch = href.match(/quote=([^&]+)/);
        if (quoteMatch) {
          try {
            const quote = decodeURIComponent(quoteMatch[1].replace(/\+/g, ' '));
            const m = quote.match(/Happy Birthday\s+(.+?)\s+from\s+/i);
            if (m) name = m[1].trim();
          } catch (_) {}
        }
        const existing = byId.get(charId);
        if (existing) {
          if (existing.name === 'Unknown' || existing.name === 'Share on Facebook') existing.name = name;
        } else {
          const favorites = favIndex < favNumbers.length ? favNumbers[favIndex++] : 0;
          byId.set(charId, { id: charId, name, thumbnail: null, url: canonicalUrl, favorites });
        }
        return;
      }

      if (!href.includes('id=')) return;
      const $img = $elem.find('img');
      const imgSrc = $img.attr('src') || $img.attr('data-src');
      const alt = $img.attr('alt') || '';
      const $parent = $elem.parent();
      const text = $parent.text().trim();
      const charUrl = href.startsWith('http') ? href : `https://www.animecharactersdatabase.com/${href.replace(/^\//, '')}`;
      let name = alt || text.split('\n')[0]?.trim() || 'Unknown';
      if (name.startsWith('Thumbnail of ')) name = name.slice(12).trim();

      if (!imgSrc) return;
      const thumb = imgSrc.startsWith('http') ? imgSrc : `https://www.animecharactersdatabase.com${imgSrc}`;
      const existing = byId.get(charId);
      if (existing) {
        existing.thumbnail = thumb;
        existing.url = charUrl;
        if (existing.name === 'Unknown' || existing.name === 'Share on Facebook') existing.name = name;
      } else {
        const favorites = favIndex < favNumbers.length ? favNumbers[favIndex++] : 0;
        byId.set(charId, { id: charId, name, thumbnail: thumb, url: charUrl, favorites });
      }
    });

    const uniqueChars = [...byId.values()];
    uniqueChars.sort((a, b) => (b.favorites ?? 0) - (a.favorites ?? 0));
    return uniqueChars;
  } catch (error) {
    console.error('Error scraping birthdays list:', error.message);
    throw error;
  }
}

export default { getTodaysBirthdays, getCharacterDetailsById, getTodaysBirthdaysListOnly };
