import { TwitterApi } from 'twitter-api-v2';
import fs from 'fs/promises';
import path from 'path';
import { recordPost, logUsageSummary } from './usage-tracker.js';

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
 */
export async function postBirthdayTweet(character, imagePath) {
  try {
    // Upload the image
    const mediaId = await uploadMedia(imagePath);

    // Create birthday message
    const message = createBirthdayMessage(character);

    // Post the tweet
    const result = await postTweet(message, [mediaId]);

    return result;
  } catch (error) {
    console.error(`Error posting birthday tweet for ${character.name}:`, error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Create a birthday message for a character
 * @param {object} character - Character data with name, series, and birthday
 */
export function createBirthdayMessage(character) {
  const nameHashtag = createHashtag(character.name);
  const seriesHashtag = createHashtag(character.series);

  // Natural style message
  let message = `🎂 Happy Birthday to ${character.name}! 🎉\n\n`;
  message += `The beloved character from ${character.series} celebrates their birthday today, ${character.birthday}.\n\n`;
  message += `#${seriesHashtag} #${nameHashtag} #AnimeBirthday`;

  // Fallback if too long
  if (message.length > 280) {
    message = `🎂 Happy Birthday to ${character.name}!\n\n`;
    message += `From ${character.series} 🎉\n\n`;
    message += `#${seriesHashtag} #AnimeBirthday`;
  }

  return message;
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
