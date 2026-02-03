import axios from 'axios';
import * as cheerio from 'cheerio';
import { isUrlLikelyPlaceholder } from './image-validation.js';

const BIRTHDAYS_URL = 'https://www.animecharactersdatabase.com/birthdays.php?today';

/**
 * Scrape today's birthday characters from animecharactersdatabase.com
 * Returns characters sorted by popularity (favorites count)
 */
export async function getTodaysBirthdays(limit = 5) {
  try {
    const response = await axios.get(BIRTHDAYS_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const $ = cheerio.load(response.data);
    const characters = [];

    // Parse character cards from the page
    // The structure has character tiles with images and info
    $('a[href*="characters.php"]').each((i, elem) => {
      const $elem = $(elem);
      const href = $elem.attr('href');

      // Skip navigation links
      if (!href || !href.includes('id=')) return;

      const $img = $elem.find('img');
      const imgSrc = $img.attr('src') || $img.attr('data-src');
      const alt = $img.attr('alt') || '';

      // Try to extract character name and series from alt or nearby text
      const $parent = $elem.parent();
      const text = $parent.text().trim();

      // Extract character ID from URL
      const idMatch = href.match(/id=(\d+)/);
      const charId = idMatch ? idMatch[1] : null;

      if (charId && imgSrc) {
        characters.push({
          id: charId,
          name: alt || text.split('\n')[0]?.trim() || 'Unknown',
          thumbnail: imgSrc.startsWith('http') ? imgSrc : `https://www.animecharactersdatabase.com${imgSrc}`,
          url: `https://www.animecharactersdatabase.com${href}`
        });
      }
    });

    // Remove duplicates by ID
    const uniqueChars = [...new Map(characters.map(c => [c.id, c])).values()];

    // Get detailed info for more characters to sort by favorites
    const charsToProcess = 25; // Process more to find the most popular ones
    const detailedChars = [];
    for (const char of uniqueChars.slice(0, charsToProcess)) {
      try {
        const details = await getCharacterDetails(char.id);
        if (details) {
          detailedChars.push({
            ...char,
            ...details
          });
        }
        // Rate limit
        await sleep(300);
      } catch (e) {
        console.error(`Failed to get details for ${char.name}:`, e.message);
      }
    }

    // Sort by favorites (most popular first)
    detailedChars.sort((a, b) => b.favorites - a.favorites);

    console.log(`[DEBUG] Top ${limit} characters by favorites:`,
      detailedChars.slice(0, limit).map(c => `${c.name} (${c.favorites} favs)`).join(', '));

    return detailedChars.slice(0, limit);
  } catch (error) {
    console.error('Error scraping birthdays:', error.message);
    throw error;
  }
}

/**
 * Get detailed character info from their page
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

    // Extract favorites/popularity
    let favorites = 0;
    const pageText = $('body').text();
    const favMatch = pageText.match(/(\d+)\s*(?:favorites?|likes?|tribute)/i);
    if (favMatch) {
      favorites = parseInt(favMatch[1], 10);
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

export default { getTodaysBirthdays, getCharacterDetailsById };
