import axios from 'axios';

const JIKAN_BASE_URL = 'https://api.jikan.moe/v4';
const RATE_LIMIT_MS = 350; // Jikan allows ~3 requests/second

let lastRequestTime = 0;

/**
 * Rate-limited request to Jikan API with retry on 429
 */
async function jikanRequest(endpoint, retries = 3) {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;

  if (timeSinceLastRequest < RATE_LIMIT_MS) {
    await sleep(RATE_LIMIT_MS - timeSinceLastRequest);
  }

  lastRequestTime = Date.now();

  try {
    const response = await axios.get(`${JIKAN_BASE_URL}${endpoint}`, {
      headers: {
        'User-Agent': 'AnimeBirthdayBot/1.0'
      }
    });

    return response.data;
  } catch (error) {
    if (error.response?.status === 429 && retries > 0) {
      console.log(`  [DEBUG] Rate limited on ${endpoint}, waiting 2s... (${retries} retries left)`);
      await sleep(2000);
      return jikanRequest(endpoint, retries - 1);
    }
    throw error;
  }
}

/**
 * Search for an anime by name and return its MAL ID
 */
async function searchAnime(animeName) {
  try {
    const query = animeName.replace(/[^\w\s]/g, ' ').trim();
    const data = await jikanRequest(`/anime?q=${encodeURIComponent(query)}&limit=5`);

    if (!data.data || data.data.length === 0) {
      return null;
    }

    // Return the first (best) match
    return {
      mal_id: data.data[0].mal_id,
      title: data.data[0].title
    };
  } catch (error) {
    console.log(`  [DEBUG] Error searching anime "${animeName}": ${error.message}`);
    return null;
  }
}

/**
 * Get all characters from an anime by its MAL ID
 */
async function getAnimeCharacters(animeId) {
  try {
    const data = await jikanRequest(`/anime/${animeId}/characters`);

    if (!data.data || data.data.length === 0) {
      return [];
    }

    return data.data;
  } catch (error) {
    console.log(`  [DEBUG] Error getting anime characters: ${error.message}`);
    return [];
  }
}

/**
 * Search for a character by name and optionally anime name
 * Returns the best matching character with image URLs
 *
 * Strategy:
 * 1. If animeName provided: search anime first, then get its characters, find match
 * 2. Fallback: global character search with anime keyword matching
 */
export async function searchCharacter(characterName, animeName = null) {
  try {
    let bestMatch = null;

    // Strategy 1: Search within specific anime (most accurate, avoids false positives)
    if (animeName) {
      console.log(`  [DEBUG] Strategy 1: Searching anime "${animeName}" first...`);
      const anime = await searchAnime(animeName);

      if (anime) {
        console.log(`  [DEBUG] Found anime: "${anime.title}" (mal_id: ${anime.mal_id})`);
        const characters = await getAnimeCharacters(anime.mal_id);

        if (characters.length > 0) {
          // Normalize character name for comparison
          const searchName = characterName.toLowerCase().replace(/[^\w\s]/g, '').trim();

          // Find exact or close match
          for (const charData of characters) {
            const charName = charData.character.name.toLowerCase();

            // Exact match
            if (charName === searchName) {
              console.log(`  [DEBUG] Exact match found: "${charData.character.name}"`);
              bestMatch = charData.character;
              break;
            }

            // Partial match (character name contains search or vice versa)
            if (charName.includes(searchName) || searchName.includes(charName)) {
              console.log(`  [DEBUG] Partial match found: "${charData.character.name}"`);
              bestMatch = charData.character;
              break;
            }
          }

          if (bestMatch) {
            // Fetch full character details for better images
            const fullChar = await getCharacterById(bestMatch.mal_id);
            if (fullChar) {
              return fullChar;
            }
          }
        }
      }
    }

    // Strategy 2: Fallback to global character search
    console.log(`  [DEBUG] Strategy 2: Global character search for "${characterName}"...`);
    const query = characterName.replace(/[^\w\s]/g, ' ').trim();
    const data = await jikanRequest(`/characters?q=${encodeURIComponent(query)}&limit=25`);

    if (!data.data || data.data.length === 0) {
      console.log(`No results found for "${characterName}"`);
      return null;
    }

    // If we have an anime name, try to match it in the character's anime list
    if (animeName && !bestMatch) {
      const animeKeywords = animeName
        .toLowerCase()
        .replace(/[^\w\s]/g, '')
        .split(/\s+/)
        .filter(word => word.length > 2 && !['the', 'no', 'ni', 'wa', 'ga', 'de', 'to'].includes(word));

      console.log(`  [DEBUG] Matching anime keywords: ${animeKeywords.join(', ')}`);

      for (const char of data.data) {
        if (char.anime && char.anime.length > 0) {
          for (const anime of char.anime) {
            const title = (anime.anime?.title || '').toLowerCase();
            const keywordMatch = animeKeywords.some(keyword => title.includes(keyword));
            if (keywordMatch) {
              console.log(`  [DEBUG] Found match: "${char.name}" in "${anime.anime?.title}"`);
              bestMatch = char;
              break;
            }
          }
        }
        if (bestMatch) break;
      }

      // Try combined search if still no match
      if (!bestMatch) {
        console.log(`  [DEBUG] Trying combined search...`);
        const combinedQuery = `${characterName} ${animeName}`.replace(/[^\w\s]/g, ' ').trim();
        const data2 = await jikanRequest(`/characters?q=${encodeURIComponent(combinedQuery)}&limit=5`);

        if (data2.data && data2.data.length > 0) {
          bestMatch = data2.data[0];
          console.log(`  [DEBUG] Combined search found: "${bestMatch.name}"`);
        }
      }
    }

    // Use first result as final fallback
    if (!bestMatch) {
      console.log(`  [DEBUG] Using first result as fallback: "${data.data[0].name}"`);
      bestMatch = data.data[0];
    }

    const image = bestMatch.images?.jpg?.image_url || bestMatch.images?.webp?.image_url || null;
    const imageLarge = bestMatch.images?.jpg?.large_image_url || bestMatch.images?.webp?.large_image_url || null;

    return {
      mal_id: bestMatch.mal_id,
      name: bestMatch.name,
      name_kanji: bestMatch.name_kanji,
      image: image,
      image_large: imageLarge,
      url: bestMatch.url,
      favorites: bestMatch.favorites || 0
    };
  } catch (error) {
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
    console.log(`  [DEBUG] downloadImage() called with URL: ${imageUrl}`);
    
    if (!imageUrl) {
      console.log(`  [DEBUG] downloadImage() - imageUrl is empty/null`);
      return null;
    }
    
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 30000, // 30 second timeout
      headers: {
        'User-Agent': 'AnimeBirthdayBot/1.0',
        'Referer': 'https://myanimelist.net/'
      }
    });

    console.log(`  [DEBUG] downloadImage() - Response status: ${response.status}, size: ${response.data?.length || 0} bytes`);

    const fs = await import('fs/promises');
    await fs.writeFile(outputPath, response.data);
    
    // Verify file was written
    const stats = await fs.stat(outputPath);
    console.log(`  [DEBUG] downloadImage() - File written successfully, size: ${stats.size} bytes`);

    return outputPath;
  } catch (error) {
    console.error(`[ERROR] downloadImage() failed for ${imageUrl}:`, error.message);
    if (error.response) {
      console.error(`  [ERROR] Response status: ${error.response.status}`);
    }
    if (error.code) {
      console.error(`  [ERROR] Error code: ${error.code}`);
    }
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
