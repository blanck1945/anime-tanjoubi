import axios from 'axios';

const JIKAN_BASE_URL = 'https://api.jikan.moe/v4';
const RATE_LIMIT_MS = 350; // Jikan allows ~3 requests/second

let lastRequestTime = 0;

/** Normalizar nombre para comparar (acentos, macrones, duplicados). MAL usa "Last, First". */
function normalizeName(s) {
  if (!s || typeof s !== 'string') return '';
  let t = s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/,/g, ' ')
    .trim();
  return t.replace(/(.)\1+/g, '$1');
}

function malNameToFirstLast(name) {
  if (!name || !name.includes(',')) return name;
  const [last, ...firstParts] = name.split(',').map(s => s.trim());
  const first = firstParts.join(' ').trim();
  return first ? `${first} ${last}` : last;
}

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
export async function searchAnime(animeName) {
  try {
    const query = animeName.replace(/[^\w\s]/g, ' ').trim();
    const data = await jikanRequest(`/anime?q=${encodeURIComponent(query)}&limit=5`);

    if (!data.data || data.data.length === 0) {
      return null;
    }

    // Return the first (best) match with genres
    const anime = data.data[0];
    return {
      mal_id: anime.mal_id,
      title: anime.title,
      genres: [...(anime.genres || []), ...(anime.themes || [])]
    };
  } catch (error) {
    console.log(`  [DEBUG] Error searching anime "${animeName}": ${error.message}`);
    return null;
  }
}

/**
 * Get all characters from an anime by its MAL ID
 */
export async function getAnimeCharacters(animeId) {
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
    let animeGenres = [];

    // Strategy 1: Search within specific anime (most accurate, avoids false positives)
    if (animeName) {
      console.log(`  [DEBUG] Strategy 1: Searching anime "${animeName}" first...`);
      const anime = await searchAnime(animeName);

      if (anime) {
        console.log(`  [DEBUG] Found anime: "${anime.title}" (mal_id: ${anime.mal_id})`);
        animeGenres = anime.genres || [];
        const characters = await getAnimeCharacters(anime.mal_id);

        if (characters.length > 0) {
          const searchNorm = normalizeName(characterName);

          for (const charData of characters) {
            const malNameRaw = (charData.character?.name || '').trim();
            const malFirstLast = malNameToFirstLast(malNameRaw);
            const charNorm = normalizeName(malFirstLast);

            const exact = charNorm === searchNorm;
            const searchParts = searchNorm.split(/\s+/).filter(Boolean);
            const partial = searchParts.length >= 2 && searchParts.every(p => charNorm.includes(p));

            if (exact || partial) {
              console.log(`  [DEBUG] Match found: "${charData.character.name}" (from anime list)`);
              bestMatch = charData.character;
              break;
            }
          }

          if (bestMatch) {
            // Fetch full character details for better images
            const fullChar = await getCharacterById(bestMatch.mal_id, animeGenres);
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

    // Strategy 2: pick best name match; prefer character whose anime list contains ACDB series (si coincide)
    if (!bestMatch) {
      const searchNorm = normalizeName(characterName);
      const animeKeywords = animeName
        ? animeName.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(w => w.length > 2 && !['the', 'no', 'ni', 'wa', 'ga', 'de', 'to'].includes(w))
        : [];

      let bestScore = -1;
      for (const char of data.data) {
        const malFirstLast = malNameToFirstLast(char.name || '');
        const charNorm = normalizeName(malFirstLast);
        const exact = charNorm === searchNorm;
        const searchParts = searchNorm.split(/\s+/).filter(Boolean);
        const partial = searchParts.length >= 2 && searchParts.every(p => charNorm.includes(p));
        const nameMatch = exact ? 2 : partial ? 1 : 0;

        let hasAnime = 0;
        if (animeKeywords.length && char.anime?.length) {
          const titles = char.anime.map(a => (a.anime?.title || '').toLowerCase()).join(' ');
          if (animeKeywords.some(kw => titles.includes(kw))) hasAnime = 1;
        }

        const score = nameMatch * 10 + hasAnime;
        if (nameMatch >= 1 && score > bestScore) {
          bestScore = score;
          bestMatch = char;
        }
      }

      if (bestMatch) {
        const animeTitle = bestMatch.anime?.[0]?.anime?.title;
        console.log(`  [DEBUG] Strategy 2 best match: "${bestMatch.name}"${animeTitle ? ` in "${animeTitle}"` : ''}`);
      }
    }

    if (!bestMatch && animeName) {
      console.log(`  [DEBUG] Trying combined search...`);
      const combinedQuery = `${characterName} ${animeName}`.replace(/[^\w\s]/g, ' ').trim();
      const data2 = await jikanRequest(`/characters?q=${encodeURIComponent(combinedQuery)}&limit=5`);
      if (data2.data?.length > 0) {
        bestMatch = data2.data[0];
        console.log(`  [DEBUG] Combined search found: "${bestMatch.name}"`);
      }
    }

    // Use first result as final fallback - BUT mark it as unverified
    let isVerifiedMatch = !!bestMatch;
    if (!bestMatch) {
      console.log(`  [DEBUG] Using first result as fallback: "${data.data[0].name}" (UNVERIFIED)`);
      bestMatch = data.data[0];
      isVerifiedMatch = false;
    }

    // Fetch full character details to get 'about' field
    const fullChar = await getCharacterById(bestMatch.mal_id, animeGenres);
    if (fullChar) {
      // Poner primero el anime que coincida con la serie buscada (para que series = anime[0].title sea correcto)
      if (animeName && fullChar.anime?.length > 1) {
        const kw = animeName.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(w => w.length > 2);
        const idx = fullChar.anime.findIndex(a => kw.some(k => (a.title || '').toLowerCase().includes(k)));
        if (idx > 0) {
          const [match] = fullChar.anime.splice(idx, 1);
          fullChar.anime.unshift(match);
        }
      }
      // If unverified match, check if character's anime list contains the expected anime
      if (!isVerifiedMatch && animeName && fullChar.anime && fullChar.anime.length > 0) {
        const animeKeywords = animeName
          .toLowerCase()
          .replace(/[^\w\s]/g, '')
          .split(/\s+/)
          .filter(word => word.length > 2);

        const animeMatches = fullChar.anime.some(a => {
          const title = (a.title || '').toLowerCase();
          return animeKeywords.some(keyword => title.includes(keyword));
        });

        if (!animeMatches) {
          console.log(`  [WARN] Character "${fullChar.name}" doesn't match anime "${animeName}" - clearing description to avoid wrong info`);
          fullChar.about = null; // Don't use wrong character's description
        }
      }
      return fullChar;
    }

    // Fallback if getCharacterById fails
    const image = bestMatch.images?.jpg?.image_url || bestMatch.images?.webp?.image_url || null;
    const imageLarge = bestMatch.images?.jpg?.large_image_url || bestMatch.images?.webp?.large_image_url || null;

    return {
      mal_id: bestMatch.mal_id,
      name: bestMatch.name,
      name_kanji: bestMatch.name_kanji,
      image: image,
      image_large: imageLarge,
      url: bestMatch.url,
      favorites: bestMatch.favorites || 0,
      genres: animeGenres,
      about: null
    };
  } catch (error) {
    console.error(`Error searching for "${characterName}":`, error.message);
    return null;
  }
}

/**
 * Get character details by MAL ID
 * @param {number} malId - MAL character ID
 * @param {Array} genres - Optional genres from the anime search
 */
export async function getCharacterById(malId, genres = []) {
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
      genres: genres,
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
  searchAnime,
  getAnimeCharacters,
  getCharacterById,
  getCharacterPictures,
  downloadImage
};
