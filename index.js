import 'dotenv/config';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

import { getTodaysBirthdays, getCharacterDetailsById } from './src/scraper.js';
import { searchCharacter, getCharacterPictures, downloadImage } from './src/jikan.js';
import { validateImageFile, isUrlLikelyPlaceholder } from './src/image-validation.js';
import { searchImagesForCharacter, isGoogleImageSearchConfigured } from './src/google-image-search.js';
import { getCharacterImage as getAnilistImage } from './src/anilist.js';
import { searchCharacterImages as searchSafebooruImages } from './src/safebooru.js';
import { initTwitterClient, postBirthdayTweet, createBirthdayMessage } from './src/twitter.js';
import { scheduleDailyPrep, schedulePosts, getScheduledJobs, POST_TIMES } from './src/scheduler.js';
import { logUsageSummary } from './src/usage-tracker.js';
import { initializeTodaysState, cleanupOldStateFiles, canRecoverFromState, loadState, isPostAlreadySent, DATA_DIR, getTodayDateString } from './src/state.js';
import { startServer } from './src/server.js';

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

  // Clean up old state files (keep last 7 days)
  await cleanupOldStateFiles();

  // Start the dashboard server
  startServer();

  // Check if we should run immediately (for testing) or schedule
  const runNow = process.argv.includes('--now') || process.argv.includes('-n');
  // TRIGGER_POST_INDEX: 0=9:00, 1=12:00, 2=15:00, 3=18:00, 4=21:00
  const triggerPostIndex = process.env.TRIGGER_POST_INDEX ? parseInt(process.env.TRIGGER_POST_INDEX, 10) : null;

  // En Railway (producción), bloquear posts manuales para evitar duplicados
  const isProduction = !!process.env.RAILWAY_ENVIRONMENT;
  const allowManualPosts = process.env.ALLOW_MANUAL_POSTS === 'true';

  if (runNow) {
    if (isProduction && !allowManualPosts) {
      console.log('\n[BLOCKED] --now flag is disabled in production to prevent duplicates.');
      console.log('[BLOCKED] Set ALLOW_MANUAL_POSTS=true to override (not recommended).\n');
    } else {
      console.log('\nRunning immediately (--now flag detected)...\n');
      await prepareAndPostAll();
    }
  } else if (triggerPostIndex !== null) {
    if (isProduction && !allowManualPosts) {
      console.log('\n[BLOCKED] TRIGGER_POST_INDEX is disabled in production to prevent duplicates.');
      console.log('[BLOCKED] Posts will only be sent via the scheduler.\n');
    } else {
      console.log(`\n[TRIGGER] TRIGGER_POST_INDEX=${triggerPostIndex} detected`);
      console.log(`[TRIGGER] Will post character at slot ${triggerPostIndex} (${POST_TIMES[triggerPostIndex]?.hour}:00)\n`);

      await preparePostsForToday();

      if (todaysPosts.length > triggerPostIndex) {
        const post = todaysPosts[triggerPostIndex];
        console.log(`\n[TRIGGER] Posting: ${post.character.name} (${post.character.series})`);
        console.log(`[TRIGGER] Birthday: ${post.character.birthday}`);
        console.log(`[TRIGGER] Image: ${post.imagePath}`);
        await postSingleBirthday(post, triggerPostIndex);
        console.log('[TRIGGER] Post complete. Exiting...');
        process.exit(0);
      } else {
        console.log(`[TRIGGER] No post available at index ${triggerPostIndex}. Only ${todaysPosts.length} posts prepared.`);
        process.exit(1);
      }
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
 * Prepare posts for today (called by scheduler or on startup).
 * If state for today already exists (e.g. after deploy), recover same characters from state
 * instead of re-scraping so we don't lose "already posted" and don't get new characters.
 */
async function preparePostsForToday() {
  try {
    // Si ya hay estado de hoy con acdbId, recuperar desde estado (mismo día, mismo deploy/restart)
    const canRecover = await canRecoverFromState();
    const stateForCheck = await loadState();
    console.log('[State check] canRecoverFromState:', canRecover, '| state exists:', !!stateForCheck, '| posts:', stateForCheck?.posts?.length ?? 0, '| all have acdbId:', stateForCheck?.posts?.every(p => p.acdbId) ?? false);

    if (canRecover) {
      console.log('[Recovery] Recovering today\'s posts from state (no re-scrape, same characters)...');
      const state = await loadState();
      todaysPosts = await recoverPostsFromState(state);
      console.log(`Recovered ${todaysPosts.length} posts from state.`);
      if (todaysPosts.length > 0) {
        schedulePosts(todaysPosts, (post) => {
          const index = todaysPosts.indexOf(post);
          return postSingleBirthday(post, index);
        });
      }
      return;
    }

    console.log('[Scrape] No recovery: fetching today\'s birthdays from ACDB...');

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

    // Guardar preview (texto + imagen) en /data para la página Vista previa (7 días)
    if (todaysPosts.length > 0) {
      const todayDate = getTodayDateString();
      const previewDir = path.join(DATA_DIR, 'preview', todayDate);
      await fs.mkdir(previewDir, { recursive: true });
      for (let i = 0; i < todaysPosts.length; i++) {
        const post = todaysPosts[i];
        post.previewText = createBirthdayMessage(post.character);
        if (post.imagePath) {
          const ext = path.extname(post.imagePath) || '.jpg';
          const dest = path.join(previewDir, `${i}${ext}`);
          try {
            await fs.copyFile(post.imagePath, dest);
          } catch (e) {
            console.warn(`[Preview] No se pudo copiar imagen post ${i}:`, e.message);
          }
        }
      }
    }

    // Initialize/update state for today
    if (todaysPosts.length > 0) {
      await initializeTodaysState(todaysPosts, POST_TIMES);

      // Schedule the posts with index for duplicate protection
      schedulePosts(todaysPosts, (post) => {
        const index = todaysPosts.indexOf(post);
        return postSingleBirthday(post, index);
      });
    }

  } catch (error) {
    console.error('Error preparing posts:', error.message);
  }
}

/**
 * Build todaysPosts from existing state (same characters, no new scrape).
 * For already-posted slots use a placeholder; for pending, re-fetch details and image by acdbId.
 */
async function recoverPostsFromState(state) {
  const posts = [];
  for (const p of state.posts) {
    if (p.status === 'posted') {
      posts.push({
        acdbId: p.acdbId,
        character: { name: p.character, series: p.series },
        imagePath: null
      });
      continue;
    }
    if (!p.acdbId) {
      console.warn(`State post ${p.index} has no acdbId, skipping recovery for that slot.`);
      posts.push({ character: { name: p.character, series: p.series }, imagePath: null });
      continue;
    }
    try {
      const details = await getCharacterDetailsById(p.acdbId);
      if (!details) {
        console.warn(`Could not fetch details for acdbId ${p.acdbId}, using placeholder.`);
        posts.push({ acdbId: p.acdbId, character: { name: p.character, series: p.series }, imagePath: null });
        continue;
      }
      const char = {
        id: p.acdbId,
        name: details.name,
        series: details.series,
        thumbnail: details.image,
        image: details.image,
        birthday: details.birthday,
        favorites: details.favorites
      };
      const prepared = await preparePostsWithImages([char]);
      if (prepared.length > 0) {
        prepared[0].acdbId = p.acdbId;
        posts.push(prepared[0]);
      } else {
        posts.push({ acdbId: p.acdbId, character: { name: p.character, series: p.series }, imagePath: null });
      }
      await sleep(300);
    } catch (e) {
      console.warn(`Recovery failed for ${p.character}:`, e.message);
      posts.push({ acdbId: p.acdbId, character: { name: p.character, series: p.series }, imagePath: null });
    }
  }
  return posts;
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

      // Priority 1: Anilist — imagen oficial del personaje (request directa)
      const anilistResult = await getAnilistImage(char.name, char.series);
      if (anilistResult?.url) {
        const imageFile = path.join(TEMP_DIR, `${sanitizeFilename(char.name)}_anilist.jpg`);
        imagePath = await downloadImage(anilistResult.url, imageFile);
        if (imagePath) {
          const validation = await validateImageFile(imagePath, char.name, char.series);
          if (validation.valid) {
            console.log(`  Downloaded image from Anilist`);
          } else {
            try { await fs.unlink(imagePath); } catch (_) {}
            imagePath = null;
          }
        }
      }

      // Priority 2: Safebooru — imágenes por tags (request directa)
      if (!imagePath) {
        const safebooruResults = await searchSafebooruImages(char.name, char.series, 5);
        for (let i = 0; i < safebooruResults.length && !imagePath; i++) {
          const result = safebooruResults[i];
          const imageFile = path.join(TEMP_DIR, `${sanitizeFilename(char.name)}_safebooru_${i}.jpg`);
          const downloaded = await downloadImage(result.url, imageFile);
          if (downloaded) {
            const validation = await validateImageFile(downloaded, char.name, char.series);
            if (validation.valid) {
              imagePath = downloaded;
              console.log(`  Downloaded image from Safebooru (result ${i + 1})`);
            } else {
              try { await fs.unlink(downloaded); } catch (_) {}
            }
          }
          await sleep(200);
        }
      }

      // Priority 3 (si está configurado): Google Image Search — mejor calidad y consistencia
      if (!imagePath && isGoogleImageSearchConfigured()) {
        console.log(`  [DEBUG] Searching Google Images for "${char.name}" (${char.series})...`);
        const googleResults = await searchImagesForCharacter(char.name, char.series, { num: 5, imgSize: 'large' });
        for (let i = 0; i < googleResults.length && !imagePath; i++) {
          const result = googleResults[i];
          const imageFile = path.join(TEMP_DIR, `${sanitizeFilename(char.name)}_google_${i}.jpg`);
          const downloaded = await downloadImage(result.url, imageFile);
          if (downloaded) {
            const validation = await validateImageFile(downloaded, char.name, char.series);
            if (validation.valid) {
              imagePath = downloaded;
              console.log(`  Downloaded image from Google Images (result ${i + 1})`);
            } else {
              try { await fs.unlink(downloaded); } catch (_) {}
            }
          }
          await sleep(200);
        }
      }

      // Priority 4: Try ACDB full image (from character page)
      if (!imagePath && char.image && !isUrlLikelyPlaceholder(char.image)) {
        const imageFile = path.join(TEMP_DIR, `${sanitizeFilename(char.name)}_acdb.jpg`);
        console.log(`  [DEBUG] Attempting ACDB image: ${char.image}`);
        
        imagePath = await downloadImage(char.image, imageFile);

        if (imagePath) {
          const validation = await validateImageFile(imagePath, char.name, char.series);
          if (!validation.valid) {
            console.log(`  [VALIDATION] ACDB image rejected: ${validation.reason}`);
            try { await fs.unlink(imagePath); } catch (_) {}
            imagePath = null;
          } else {
            const stats = await fs.stat(imagePath);
            console.log(`  Downloaded image from ACDB (${stats.size} bytes)`);
          }
        }
      } else if (!imagePath && char.image && isUrlLikelyPlaceholder(char.image)) {
        console.log(`  [VALIDATION] ACDB image URL looks like placeholder, skipping`);
      }

      // Priority 5: Try MAL image (prefer large, fallback to regular)
      if (!imagePath) {
        const malImageUrl = malChar?.image_large || malChar?.image;
        if (malImageUrl && malImageUrl !== 'undefined') {
          const imageFile = path.join(TEMP_DIR, `${sanitizeFilename(char.name)}_mal.jpg`);
          console.log(`  [DEBUG] Attempting MAL image: ${malImageUrl}`);
          
          imagePath = await downloadImage(malImageUrl, imageFile);

          if (imagePath) {
            const validation = await validateImageFile(imagePath, char.name, char.series);
            if (!validation.valid) {
              console.log(`  [VALIDATION] MAL image rejected: ${validation.reason}`);
              try { await fs.unlink(imagePath); } catch (_) {}
              imagePath = null;
            } else {
              const stats = await fs.stat(imagePath);
              console.log(`  Downloaded image from MAL (${stats.size} bytes)`);
            }
          } else {
            console.log(`  [DEBUG] MAL image download returned null`);
          }
        }
      }

      // Priority 6: Fallback to ACDB thumbnail (but verify it's not the default placeholder)
      if (!imagePath && char.thumbnail && !isUrlLikelyPlaceholder(char.thumbnail)) {
        const imageFile = path.join(TEMP_DIR, `${sanitizeFilename(char.name)}_thumb.jpg`);
        console.log(`  [DEBUG] Attempting ACDB thumbnail: ${char.thumbnail}`);
        
        imagePath = await downloadImage(char.thumbnail, imageFile);

        if (imagePath) {
          const validation = await validateImageFile(imagePath, char.name, char.series);
          if (!validation.valid) {
            console.log(`  [VALIDATION] ACDB thumbnail rejected: ${validation.reason}`);
            try { await fs.unlink(imagePath); } catch (_) {}
            imagePath = null;
          } else {
            const stats = await fs.stat(imagePath);
            console.log(`  Downloaded thumbnail from ACDB (${stats.size} bytes)`);
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
        acdbId: char.id || null,
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
 * @param {object} postData - Post data with character and imagePath
 * @param {number} index - Post index for duplicate protection
 */
async function postSingleBirthday(postData, index = null) {
  try {
    if (!postData.imagePath) {
      // Placeholder (already posted or failed to prepare) – skip upload
      if (index !== null && await isPostAlreadySent(index)) {
        console.log(`Skipped (already posted): ${postData.character.name}`);
        return { success: true, skipped: true, reason: 'already_posted' };
      }
      console.error(`No image for post index ${index}, skipping.`);
      return { success: false, error: 'No image' };
    }
    const result = await postBirthdayTweet(postData.character, postData.imagePath, index);

    if (result.skipped) {
      console.log(`Skipped (already posted): ${postData.character.name}`);
      return result;
    }

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

    await postSingleBirthday(post, i);

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
