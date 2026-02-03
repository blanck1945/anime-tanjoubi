import { TwitterApi } from 'twitter-api-v2';
import fs from 'fs/promises';
import path from 'path';
import { recordPost, logUsageSummary } from './usage-tracker.js';
import { isPostAlreadySent, markPostAsSent, markPostAsFailed } from './state.js';

let client = null;

/**
 * Initialize Twitter client with credentials
 */
export function initTwitterClient(credentials) {
  client = new TwitterApi({
    appKey: credentials.apiKey,
    appSecret: credentials.apiSecret,
    accessToken: credentials.accessToken,
    accessSecret: credentials.accessTokenSecret,
  });

  return client;
}

/**
 * Get the initialized client
 */
export function getClient() {
  if (!client) {
    throw new Error('Twitter client not initialized. Call initTwitterClient first.');
  }
  return client;
}

/**
 * Upload media (image or video) to Twitter
 * @param {string} filePath - Path to the media file
 * @returns {string} - Media ID
 */
export async function uploadMedia(filePath) {
  const twitterClient = getClient();

  try {
    const mediaData = await fs.readFile(filePath);
    const mediaType = getMediaType(filePath);

    let mediaId;

    if (mediaType.startsWith('video/')) {
      // For videos, use chunked upload
      mediaId = await twitterClient.v1.uploadMedia(filePath, {
        mimeType: mediaType,
        chunkLength: 1024 * 1024 * 5, // 5MB chunks
        longVideo: true
      });
    } else {
      // For images
      mediaId = await twitterClient.v1.uploadMedia(filePath, {
        mimeType: mediaType
      });
    }

    console.log(`Media uploaded successfully: ${mediaId}`);
    return mediaId;
  } catch (error) {
    console.error('Error uploading media:', error.message);
    throw error;
  }
}

/**
 * Post a tweet with optional media
 * @param {string} text - Tweet text
 * @param {string[]} mediaIds - Array of media IDs (optional)
 * @returns {object} - Tweet data
 */
export async function postTweet(text, mediaIds = []) {
  const twitterClient = getClient();

  try {
    const tweetOptions = { text };

    if (mediaIds && mediaIds.length > 0) {
      tweetOptions.media = { media_ids: mediaIds };
    }

    const tweet = await twitterClient.v2.tweet(tweetOptions);

    console.log(`Tweet posted successfully: ${tweet.data.id}`);

    // Track usage for budget monitoring
    recordPost({
      tweetId: tweet.data.id,
      characterName: tweetOptions.text?.substring(0, 50) || 'Unknown'
    });

    return {
      success: true,
      id: tweet.data.id,
      text: tweet.data.text,
      url: `https://twitter.com/i/status/${tweet.data.id}`
    };
  } catch (error) {
    console.error('Error posting tweet:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Post a birthday tweet for a character
 * @param {object} character - Character data
 * @param {string} imagePath - Path to character image
 * @param {number} postIndex - Index of the post (for duplicate protection)
 */
export async function postBirthdayTweet(character, imagePath, postIndex = null) {
  try {
    // Check if already posted (duplicate protection)
    if (postIndex !== null) {
      const alreadySent = await isPostAlreadySent(postIndex);
      if (alreadySent) {
        console.log(`[SKIP] ${character.name} already posted (index ${postIndex})`);
        return {
          success: true,
          skipped: true,
          reason: 'already_posted'
        };
      }
    }

    // Upload the image
    const mediaId = await uploadMedia(imagePath);

    // Create birthday message
    const message = createBirthdayMessage(character);

    // Post the tweet
    const result = await postTweet(message, [mediaId]);

    // Update state if successful
    if (result.success && postIndex !== null) {
      await markPostAsSent(postIndex, result.id, result.url);
    } else if (!result.success && postIndex !== null) {
      await markPostAsFailed(postIndex, result.error);
    }

    return result;
  } catch (error) {
    console.error(`Error posting birthday tweet for ${character.name}:`, error.message);

    // Mark as failed in state
    if (postIndex !== null) {
      await markPostAsFailed(postIndex, error.message);
    }

    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Create a birthday message for a character
 * @param {object} character - Character data with name, series, birthday, about, and genres
 */
export function createBirthdayMessage(character) {
  const nameHashtag = createHashtag(character.name);
  const seriesHashtag = createHashtag(character.series);

  // Extraer descripción del personaje
  const description = extractDescription(character.about);

  // Obtener hasta 2 géneros para hashtags
  const genreHashtags = (character.genres || [])
    .slice(0, 2)
    .map(g => `#${createHashtag(g.name || g)}`)
    .join(' ');

  // Mensaje personalizado
  let message = `🎂 Happy Birthday to ${character.name}! 🎉\n\n`;

  if (description) {
    message += `${description}\n\n`;
  } else {
    message += `The beloved character from ${character.series} celebrates today.\n\n`;
  }

  // Fecha
  message += `📅 ${character.birthday}\n\n`;

  // Hashtags: Serie + Nombre + AnimeBirthday + Anime + HappyBirthday + 2 géneros
  message += `#${seriesHashtag} #${nameHashtag} #AnimeBirthday #Anime #HappyBirthday ${genreHashtags}`;

  // Fallback si excede 280 caracteres
  if (message.length > 280) {
    message = `🎂 Happy Birthday ${character.name}! 🎉\n`;
    message += `From ${character.series}\n\n`;
    message += `#${seriesHashtag} #AnimeBirthday #Anime #HappyBirthday`;
  }

  return message;
}

/**
 * Extract a meaningful description from the character's about text
 * @param {string} about - Raw about text from MAL
 */
function extractDescription(about) {
  if (!about) return null;

  // Patrones de metadata a ignorar
  const metadataPattern = /^(Age|Birthday|Date of Birth|Height|Weight|Blood|Source|Hair|Eye|Affiliation|Occupation|Status|Race|Gender|Species|Nationality|Position|Allegiance|VA|Voice|Seiyuu|CV|Voiced|Actor|Actress|Japanese|English|Origin|Title|Rank|Role|Class|Abilities|Power|Weapon|Family|Relatives|Partner|Team|Clan|Organization|School|Grade|Year|Zodiac|Sign|Hobbies|Likes|Dislikes|Quote|Motto|Theme|Song|First|Anime|Manga|Novel|Game|Episode|Chapter|Volume|Arc|Saga|Series)[\s]*:/i;

  // Dividir en párrafos y líneas
  const paragraphs = about.split(/\n\n+/).map(p => p.trim()).filter(p => p);

  for (const paragraph of paragraphs) {
    // Saltar párrafos cortos o que son solo metadata
    const lines = paragraph.split('\n').filter(l => l.trim());

    // Buscar línea que sea descripción real (no metadata, más de 50 chars, tiene verbos/estructura de oración)
    for (const line of lines) {
      const trimmed = line.trim();

      // Saltar metadata
      if (metadataPattern.test(trimmed)) continue;

      // Saltar líneas cortas
      if (trimmed.length < 50) continue;

      // Saltar líneas que parecen listas o headers
      if (trimmed.startsWith('-') || trimmed.startsWith('•') || trimmed.endsWith(':')) continue;

      // Buscar una oración que describa al personaje (usualmente tiene "is", "was", "has", etc.)
      if (trimmed.match(/\b(is|was|are|were|has|had|becomes|became|works|serves|leads)\b/i)) {
        // Extraer primera oración completa
        const sentences = trimmed.match(/[^.!?]+[.!?]+/g);
        if (sentences && sentences[0]) {
          const firstSentence = sentences[0].trim();
          // Limpiar nombre japonés entre paréntesis si está al inicio
          const cleaned = firstSentence.replace(/\s*\([^)]*[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF][^)]*\)\s*,?\s*/g, ' ').trim();
          if (cleaned.length > 30) {
            return cleaned.length > 120 ? cleaned.substring(0, 117) + '...' : cleaned;
          }
        }
      }
    }
  }

  return null;
}

/**
 * Create a valid hashtag from text
 */
function createHashtag(text) {
  if (!text) return '';

  return text
    .replace(/[^\w\s]/g, '') // Remove special characters
    .replace(/\s+/g, '')     // Remove spaces
    .substring(0, 50);       // Limit length
}

/**
 * Get MIME type from file extension
 */
function getMediaType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime'
  };
  return types[ext] || 'application/octet-stream';
}

export default {
  initTwitterClient,
  getClient,
  uploadMedia,
  postTweet,
  postBirthdayTweet,
  createBirthdayMessage
};
