import axios from 'axios';

const JIKAN_BASE_URL = 'https://api.jikan.moe/v4';
const RATE_LIMIT_MS = 350; // Jikan allows ~3 requests/second

let lastRequestTime = 0;

/**
 * Rate-limited request to Jikan API
 */
async function jikanRequest(endpoint) {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;

  if (timeSinceLastRequest < RATE_LIMIT_MS) {
    await sleep(RATE_LIMIT_MS - timeSinceLastRequest);
  }

  lastRequestTime = Date.now();

  const response = await axios.get(`${JIKAN_BASE_URL}${endpoint}`, {
    headers: {
      'User-Agent': 'AnimeBirthdayBot/1.0'
    }
  });

  return response.data;
}

/**
 * Search for a character by name and optionally anime name
 * Returns the best matching character with image URLs
 */
export async function searchCharacter(characterName, animeName = null) {
  try {
    // Clean up the search query
    const query = characterName.replace(/[^\w\s]/g, ' ').trim();

    const data = await jikanRequest(`/characters?q=${encodeURIComponent(query)}&limit=10`);

    if (!data.data || data.data.length === 0) {
      console.log(`No results found for "${characterName}"`);
      return null;
    }

    let bestMatch = null;

    // If we have an anime name, try to match it
    if (animeName) {
      const animeClean = animeName.toLowerCase().replace(/[^\w\s]/g, '');

      for (const char of data.data) {
        // Check if character appears in the specified anime
        if (char.anime && char.anime.length > 0) {
          for (const anime of char.anime) {
            const title = (anime.anime?.title || '').toLowerCase();
            if (title.includes(animeClean) || animeClean.includes(title)) {
              bestMatch = char;
              break;
            }
          }
        }
        if (bestMatch) break;
      }
    }

    // If no anime match, use the first result (usually most popular)
    if (!bestMatch) {
      bestMatch = data.data[0];
    }

    return {
      mal_id: bestMatch.mal_id,
      name: bestMatch.name,
      name_kanji: bestMatch.name_kanji,
      image: bestMatch.images?.jpg?.image_url || bestMatch.images?.webp?.image_url,
      image_large: bestMatch.images?.jpg?.large_image_url || bestMatch.images?.webp?.large_image_url,
      url: bestMatch.url,
      favorites: bestMatch.favorites || 0
    };
  } catch (error) {
    if (error.response?.status === 429) {
      console.log('Rate limited, waiting...');
      await sleep(1000);
      return searchCharacter(characterName, animeName);
    }
    console.error(`Error searching for "${characterName}":`, error.message);
    return null;
  }
}

/**
 * Get character details by MAL ID
 */
export async function getCharacterById(malId) {
  try {
    const data = await jikanRequest(`/characters/${malId}/full`);

    if (!data.data) {
      return null;
    }

    const char = data.data;

    return {
      mal_id: char.mal_id,
      name: char.name,
      name_kanji: char.name_kanji,
      nicknames: char.nicknames || [],
      about: char.about,
      image: char.images?.jpg?.image_url,
      image_large: char.images?.jpg?.large_image_url,
      url: char.url,
      favorites: char.favorites || 0,
      anime: char.anime?.map(a => ({
        mal_id: a.anime?.mal_id,
        title: a.anime?.title,
        role: a.role
      })) || []
    };
  } catch (error) {
    console.error(`Error getting character ${malId}:`, error.message);
    return null;
  }
}

/**
 * Get character images/pictures from MAL
 */
export async function getCharacterPictures(malId) {
  try {
    const data = await jikanRequest(`/characters/${malId}/pictures`);

    if (!data.data || data.data.length === 0) {
      return [];
    }

    return data.data.map(pic => ({
      jpg: pic.jpg?.image_url,
      jpg_large: pic.jpg?.large_image_url,
      webp: pic.webp?.image_url,
      webp_large: pic.webp?.large_image_url
    }));
  } catch (error) {
    console.error(`Error getting pictures for character ${malId}:`, error.message);
    return [];
  }
}

/**
 * Download an image to a local file
 */
export async function downloadImage(imageUrl, outputPath) {
  try {
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'AnimeBirthdayBot/1.0',
        'Referer': 'https://myanimelist.net/'
      }
    });

    const fs = await import('fs/promises');
    await fs.writeFile(outputPath, response.data);

    return outputPath;
  } catch (error) {
    console.error(`Error downloading image from ${imageUrl}:`, error.message);
    return null;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export default {
  searchCharacter,
  getCharacterById,
  getCharacterPictures,
  downloadImage
};
