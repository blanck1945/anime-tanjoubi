import 'dotenv/config';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

import { getTodaysBirthdays } from './src/scraper.js';
import { searchCharacter, getCharacterPictures, downloadImage } from './src/jikan.js';
import { initTwitterClient, postBirthdayTweet } from './src/twitter.js';
import { scheduleDailyPrep, schedulePosts, getScheduledJobs, POST_TIMES } from './src/scheduler.js';
import { logUsageSummary } from './src/usage-tracker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEMP_DIR = path.join(__dirname, 'temp');
const NUM_POSTS = 6;

// Store prepared posts for the day
let todaysPosts = [];

/**
 * Main entry point
 */
async function main() {
  console.log('===========================================');
  console.log('  Anime Birthday Bot - Starting...');
  console.log('===========================================');

  // Validate environment variables
  validateConfig();

  // Initialize Twitter client
  initTwitterClient({
    apiKey: process.env.API_KEY,
    apiSecret: process.env.API_SECRET,
    accessToken: process.env.ACCESS_TOKEN,
    accessTokenSecret: process.env.ACCESS_TOKEN_SECRET
  });

  console.log('Twitter client initialized.');

  // Ensure temp directory exists
  await fs.mkdir(TEMP_DIR, { recursive: true });

  // Check if we should run immediately (for testing) or schedule
  const runNow = process.argv.includes('--now') || process.argv.includes('-n');
  // TRIGGER_POST_INDEX: 0=9:00, 1=12:00, 2=15:00, 3=18:00, 4=21:00
  const triggerPostIndex = process.env.TRIGGER_POST_INDEX ? parseInt(process.env.TRIGGER_POST_INDEX, 10) : null;

  if (runNow) {
    console.log('\nRunning immediately (--now flag detected)...\n');
    await prepareAndPostAll();
  } else if (triggerPostIndex !== null) {
    console.log(`\n[TRIGGER] TRIGGER_POST_INDEX=${triggerPostIndex} detected`);
    console.log(`[TRIGGER] Will post character at slot ${triggerPostIndex} (${POST_TIMES[triggerPostIndex]?.hour}:00)\n`);
    
    await preparePostsForToday();
    
    if (todaysPosts.length > triggerPostIndex) {
      const post = todaysPosts[triggerPostIndex];
      console.log(`\n[TRIGGER] Posting: ${post.character.name} (${post.character.series})`);
      console.log(`[TRIGGER] Birthday: ${post.character.birthday}`);
      console.log(`[TRIGGER] Image: ${post.imagePath}`);
      await postSingleBirthday(post);
      console.log('[TRIGGER] Post complete. Exiting...');
      process.exit(0);
    } else {
      console.log(`[TRIGGER] No post available at index ${triggerPostIndex}. Only ${todaysPosts.length} posts prepared.`);
      process.exit(1);
    }
  } else {
    // Schedule daily preparation
    scheduleDailyPrep(preparePostsForToday);

    // Check if we should prepare now (if it's after prep time but before last post time)
    // Use Argentina timezone for the check
    const now = new Date();
    const argentinaHour = parseInt(now.toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires', hour: 'numeric', hour12: false }));

    if (argentinaHour >= 8 && argentinaHour < 22) {
      console.log('\nPreparing posts for today...\n');
      await preparePostsForToday();
    }

    console.log('\n===========================================');
    console.log('  Bot is running. Scheduled jobs:');
    console.log('===========================================');

    const jobs = getScheduledJobs();
    jobs.forEach(job => {
      console.log(`  - ${job.name}: ${job.nextInvocation?.toLocaleString() || 'pending'}`);
    });

    console.log('\nPress Ctrl+C to stop.\n');
  }
}

/**
 * Validate required configuration
 */
function validateConfig() {
  const required = ['API_KEY', 'API_SECRET', 'ACCESS_TOKEN', 'ACCESS_TOKEN_SECRET'];
  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    console.error('Missing required environment variables:', missing.join(', '));
    console.error('Please create a .env file with your Twitter API credentials.');
    process.exit(1);
  }
}

/**
 * Prepare posts for today (called by scheduler or on startup)
 */
async function preparePostsForToday() {
  try {
    console.log('Fetching today\'s birthdays...');

    // Get today's birthday characters
    const characters = await getTodaysBirthdays(NUM_POSTS);

    if (characters.length === 0) {
      console.log('No birthday characters found for today.');
      return;
    }

    console.log(`Found ${characters.length} birthday characters:`);
    characters.forEach((char, i) => {
      console.log(`  ${i + 1}. ${char.name} (${char.series})`);
    });

    // Prepare posts with images
    todaysPosts = await preparePostsWithImages(characters);

    console.log(`\nPrepared ${todaysPosts.length} posts.`);

    // Schedule the posts
    if (todaysPosts.length > 0) {
      schedulePosts(todaysPosts, postSingleBirthday);
    }

  } catch (error) {
    console.error('Error preparing posts:', error.message);
  }
}

/**
 * Prepare posts with images from Jikan
 */
async function preparePostsWithImages(characters) {
  const posts = [];

  for (const char of characters) {
    console.log(`\nPreparing post for ${char.name}...`);
    console.log(`  [DEBUG] Character data: name="${char.name}", series="${char.series}", birthday="${char.birthday}", thumbnail="${char.thumbnail}"`);

    try {
      // Search for character on MAL via Jikan
      console.log(`  [DEBUG] Searching MAL for "${char.name}" in "${char.series}"...`);
      const malChar = await searchCharacter(char.name, char.series);

      if (malChar) {
        console.log(`  [DEBUG] MAL result: name="${malChar.name}", image="${malChar.image}", image_large="${malChar.image_large}"`);
      } else {
        console.log(`  [DEBUG] MAL search returned null`);
      }

      let imagePath = null;

      // Priority 1: Try ACDB full image (from character page)
      if (char.image) {
        const imageFile = path.join(TEMP_DIR, `${sanitizeFilename(char.name)}_acdb.jpg`);
        console.log(`  [DEBUG] Attempting ACDB image: ${char.image}`);
        
        imagePath = await downloadImage(char.image, imageFile);

        if (imagePath) {
          const stats = await fs.stat(imagePath);
          if (stats.size > 5000) { // ACDB images should be decent size
            console.log(`  Downloaded image from ACDB (${stats.size} bytes)`);
          } else {
            console.log(`  [DEBUG] ACDB image too small (${stats.size} bytes)`);
            await fs.unlink(imagePath);
            imagePath = null;
          }
        }
      }

      // Priority 2: Try MAL image (prefer large, fallback to regular)
      if (!imagePath) {
        const malImageUrl = malChar?.image_large || malChar?.image;
        if (malImageUrl && malImageUrl !== 'undefined') {
          const imageFile = path.join(TEMP_DIR, `${sanitizeFilename(char.name)}_mal.jpg`);
          console.log(`  [DEBUG] Attempting MAL image: ${malImageUrl}`);
          
          imagePath = await downloadImage(malImageUrl, imageFile);

          if (imagePath) {
            const stats = await fs.stat(imagePath);
            if (stats.size > 1000) {
              console.log(`  Downloaded image from MAL (${stats.size} bytes)`);
            } else {
              console.log(`  [DEBUG] MAL image too small (${stats.size} bytes)`);
              await fs.unlink(imagePath);
              imagePath = null;
            }
          } else {
            console.log(`  [DEBUG] MAL image download returned null`);
          }
        }
      }

      // Priority 3: Fallback to ACDB thumbnail (but verify it's not the default placeholder)
      if (!imagePath && char.thumbnail && !char.thumbnail.includes('forum/67712-596211384')) {
        const imageFile = path.join(TEMP_DIR, `${sanitizeFilename(char.name)}_thumb.jpg`);
        console.log(`  [DEBUG] Attempting ACDB thumbnail: ${char.thumbnail}`);
        
        imagePath = await downloadImage(char.thumbnail, imageFile);

        if (imagePath) {
          const stats = await fs.stat(imagePath);
          if (stats.size > 1000) {
            console.log(`  Downloaded thumbnail from ACDB (${stats.size} bytes)`);
          } else {
            console.log(`  [DEBUG] Thumbnail too small (${stats.size} bytes)`);
            await fs.unlink(imagePath);
            imagePath = null;
          }
        } else {
          console.log(`  [DEBUG] Thumbnail download also returned null`);
        }
      } else if (!imagePath) {
        console.log(`  [DEBUG] No valid image source available`);
      }

      if (!imagePath) {
        console.log(`  [WARN] No image available for ${char.name}, skipping...`);
        continue;
      }
      
      console.log(`  [DEBUG] Final image path: ${imagePath}`);

      posts.push({
        character: {
          name: malChar?.name || char.name,
          name_kanji: malChar?.name_kanji || null,
          series: char.series,
          favorites: malChar?.favorites || char.favorites,
          birthday: char.birthday,
          about: malChar?.about || null,
          genres: malChar?.genres || []
        },
        imagePath
      });

    } catch (error) {
      console.error(`  Error preparing ${char.name}:`, error.message);
    }

    // Rate limit
    await sleep(500);
  }

  return posts;
}

/**
 * Post a single birthday tweet
 */
async function postSingleBirthday(postData) {
  try {
    const result = await postBirthdayTweet(postData.character, postData.imagePath);

    if (result.success) {
      console.log(`Posted: ${result.url}`);

      // Clean up the image file
      try {
        await fs.unlink(postData.imagePath);
      } catch (e) {
        // Ignore cleanup errors
      }
    } else {
      console.error(`Failed to post: ${result.error}`);
    }

    return result;
  } catch (error) {
    console.error('Error posting birthday:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Prepare and post all immediately (for testing)
 */
async function prepareAndPostAll() {
  await preparePostsForToday();

  if (todaysPosts.length === 0) {
    console.log('No posts to make.');
    return;
  }

  console.log(`\nPosting ${todaysPosts.length} birthday tweets...\n`);

  for (let i = 0; i < todaysPosts.length; i++) {
    const post = todaysPosts[i];
    console.log(`[${i + 1}/${todaysPosts.length}] Posting ${post.character.name}...`);

    await postSingleBirthday(post);

    // Wait between posts to avoid rate limits
    if (i < todaysPosts.length - 1) {
      console.log('Waiting 30 seconds before next post...');
      await sleep(30000);
    }
  }

  console.log('\nAll posts complete!');
}

/**
 * Sanitize filename
 */
function sanitizeFilename(name) {
  return name
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 50);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  logUsageSummary();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nShutting down...');
  logUsageSummary();
  process.exit(0);
});

// Start the bot
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
