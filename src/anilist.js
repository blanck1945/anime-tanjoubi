/**
 * Anilist GraphQL API — obtener imagen oficial del personaje por nombre/serie.
 * Sin API key. Endpoint: https://graphql.anilist.co
 */

import axios from 'axios';

const ANILIST_URL = 'https://graphql.anilist.co';

const SEARCH_CHARACTER_QUERY = `
  query ($search: String) {
    Page(page: 1, perPage: 5) {
      characters(search: $search) {
        id
        name { full }
        image { large }
        media {
          nodes {
            title { romaji english }
          }
        }
      }
    }
  }
`;

/**
 * Busca personaje por nombre y opcionalmente filtra por serie.
 * @param {string} characterName
 * @param {string} series - nombre del anime/serie (para filtrar)
 * @returns {Promise<{ url: string, characterName: string } | null>}
 */
export async function getCharacterImage(characterName, series) {
  try {
    const response = await axios.post(
      ANILIST_URL,
      {
        query: SEARCH_CHARACTER_QUERY,
        variables: { search: characterName }
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000
      }
    );

    const characters = response.data?.data?.Page?.characters;
    if (!characters || characters.length === 0) return null;

    const seriesLower = (series || '').toLowerCase().replace(/\s+/g, ' ');
    const seriesWords = seriesLower.split(' ').filter(w => w.length > 1);

    for (const char of characters) {
      const imageUrl = char.image?.large;
      if (!imageUrl) continue;

      const mediaTitles = (char.media?.nodes || [])
        .map(n => [n.title?.romaji, n.title?.english].filter(Boolean).join(' '))
        .join(' ')
        .toLowerCase();

      if (!seriesWords.length) {
        return { url: imageUrl, characterName: char.name?.full || characterName };
      }
      const match = seriesWords.some(w => mediaTitles.includes(w));
      if (match) {
        return { url: imageUrl, characterName: char.name?.full || characterName };
      }
    }

    return { url: characters[0].image?.large, characterName: characters[0].name?.full || characterName };
  } catch (error) {
    console.warn('[Anilist] Error:', error.message);
    return null;
  }
}

export default { getCharacterImage };
