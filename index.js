import 'dotenv/config';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

import { getTodaysBirthdays } from './src/scraper.js';
import { searchCharacter } from './src/jikan.js';
import { resolveImageForCharacter } from './src/image-resolver.js';
import { initTwitterClient, postBirthdayTweet, getBirthdayMessage } from './src/twitter.js';
import { POST_TIMES, PREP_TIME } from './src/scheduler.js';
import { getDayDoc, saveDayDoc, updatePostStatus, closeMongo } from './src/supabase.js';
import { uploadPostImage, downloadPostImage } from './src/s3.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEMP_DIR = path.join(__dirname, 'temp');
const NUM_POSTS = 7;
const ARGENTINA_TZ = 'America/Argentina/Buenos_Aires';

function getTodayDateString() {
  return new Date().toLocaleDateString('en-CA', { timeZone: ARGENTINA_TZ });
}

function formatScheduledTime(timeObj) {
  const h = timeObj.hour.toString().padStart(2, '0');
  const m = (timeObj.minute || 0).toString().padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * Con 1 solo cron (ej. cada 30 min): decide por hora Argentina si hacer prep o post N.
 * Ventana de 30 min por slot.
 */
function getScheduledActionNow() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: ARGENTINA_TZ, hour: 'numeric', minute: 'numeric', hour12: false });
  const parts = formatter.formatToParts(now);
  const hour = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0', 10);
  const minute = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0', 10);
  const slot = hour * 60 + minute;
  const WINDOW = 30;

  const inWindow = (h, m) => {
    const start = h * 60 + m;
    return slot >= start && slot < start + WINDOW;
  };
  if (inWindow(PREP_TIME.hour, PREP_TIME.minute)) return 'prep';
  for (let i = 0; i < POST_TIMES.length; i++) {
    const t = POST_TIMES[i];
    if (inWindow(t.hour, t.minute)) return i;
  }
  return null;
}

/**
 * Main: CRON_ACTION (7 crons) | 1 cron por hora Argentina | local (--prep | --post N)
 */
async function main() {
  const cronAction = process.env.CRON_ACTION;
  const hasPrep = process.argv.includes('--prep');
  const limitArg = process.argv.find(a => a.startsWith('--limit='));
  const prepLimit = limitArg ? parseInt(limitArg.split('=')[1], 10) : (process.env.PREP_LIMIT ? parseInt(process.env.PREP_LIMIT, 10) : null);
  const postArg = process.argv.find(a => a.startsWith('--post='));
  const postIndexArg = postArg ? parseInt(postArg.split('=')[1], 10) : null;

  if (cronAction === 'prep' || hasPrep) {
    await runPrep(isNaN(prepLimit) ? null : prepLimit);
    await closeMongo();
    process.exit(0);
  }

  if (cronAction === 'post' || (postIndexArg !== undefined && !isNaN(postIndexArg))) {
    const index = cronAction === 'post'
      ? parseInt(process.env.CRON_POST_INDEX ?? '0', 10)
      : postIndexArg;
    await runPost(index);
    await closeMongo();
    process.exit(0);
  }

  // 1 solo cron en Railway: decidir por hora Argentina (ventanas de 30 min)
  const scheduled = getScheduledActionNow();
  if (scheduled === 'prep') {
    console.log('[Cron] Hora Argentina: ejecutando prep');
    await runPrep(null);
    await closeMongo();
    process.exit(0);
  }
  if (typeof scheduled === 'number') {
    // Si aún no hay prep del día, hacer prep primero (primer run del día)
    const date = getTodayDateString();
    const doc = await getDayDoc(date);
    if (!doc?.posts?.length) {
      console.log('[Cron] No hay posts del día; ejecutando prep primero');
      await runPrep(null);
    }
    console.log(`[Cron] Hora Argentina: ejecutando post ${scheduled}`);
    await runPost(scheduled);
    await closeMongo();
    process.exit(0);
  }

  if (process.env.RAILWAY_CRON || process.env.RAILWAY_ENVIRONMENT) {
    process.exit(0);
  }
  console.log('Usage: CRON_ACTION=prep node index.js  |  node index.js --prep  |  node index.js --post=0');
  process.exit(1);
}

function validateConfig() {
  const required = ['API_KEY', 'API_SECRET', 'ACCESS_TOKEN', 'ACCESS_TOKEN_SECRET'];
  const missing = required.filter(key => !process.env[key]);
  if (missing.length > 0) {
    console.error('Missing required environment variables:', missing.join(', '));
    process.exit(1);
  }
}

/**
 * Prep: scrape ACDB, prepare images, Gemini texts, upload to S3, save to Supabase
 * @param {number|null} limit - Número de personajes (ej. 1 para test). Si null, usa NUM_POSTS (6).
 */
async function runPrep(limit = null) {
  console.log('===========================================');
  console.log('  Anime Birthday Bot - PREP');
  console.log('===========================================');

  validateConfig();
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for prep');
    process.exit(1);
  }
  if (!process.env.S3_BUCKET && !process.env.AWS_BUCKET) {
    console.error('S3_BUCKET (or AWS_BUCKET) is required for prep');
    process.exit(1);
  }

  const prepLimit = limit ?? NUM_POSTS;
  if (prepLimit === 1) {
    console.log('[TEST] Prep limitado a 1 personaje\n');
  }

  initTwitterClient({
    apiKey: process.env.API_KEY,
    apiSecret: process.env.API_SECRET,
    accessToken: process.env.ACCESS_TOKEN,
    accessTokenSecret: process.env.ACCESS_TOKEN_SECRET
  });
  await fs.mkdir(TEMP_DIR, { recursive: true });

  const date = getTodayDateString();
  console.log(`Date (Argentina): ${date}\n`);

  const characters = await getTodaysBirthdays(prepLimit);
  if (characters.length === 0) {
    console.log('No birthday characters found for today.');
    return;
  }

  console.log(`Found ${characters.length} characters:`);
  characters.forEach((c, i) => console.log(`  ${i + 1}. ${c.name} (${c.series})`));

  const preparedPosts = await preparePostsWithImages(characters);
  if (preparedPosts.length === 0) {
    console.log('No posts prepared (no valid images).');
    return;
  }

  const posts = [];
  for (let i = 0; i < preparedPosts.length; i++) {
    const post = preparedPosts[i];
    const previewText = await getBirthdayMessage(post.character);
    let imageUrl = null;
    if (post.imagePath) {
      try {
        imageUrl = await uploadPostImage(post.imagePath, date, post.character.name, i);
        console.log(`[S3] ${i} ${post.character.name} -> ${imageUrl}`);
      } catch (e) {
        console.warn(`[S3] Upload failed for ${post.character.name}:`, e.message);
      }
    }
    posts.push({
      index: i,
      character: post.character.name,
      series: post.character.series,
      scheduledTime: formatScheduledTime(POST_TIMES[i] || { hour: 9, minute: 0 }),
      previewText: previewText || '',
      imageUrl,
      status: 'pending',
      postedAt: null,
      tweetUrl: null,
      error: null
    });
  }

  const doc = {
    date,
    preparedAt: new Date().toISOString(),
    posts
  };
  await saveDayDoc(doc);
  console.log(`\nSaved to Supabase: ${date} (${posts.length} posts)`);
}

/**
 * Post: load day from Mongo, post at index, update Mongo
 */
async function runPost(index) {
  console.log('===========================================');
  console.log('  Anime Birthday Bot - POST', index);
  console.log('===========================================');

  validateConfig();
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for post');
    process.exit(1);
  }

  initTwitterClient({
    apiKey: process.env.API_KEY,
    apiSecret: process.env.API_SECRET,
    accessToken: process.env.ACCESS_TOKEN,
    accessTokenSecret: process.env.ACCESS_TOKEN_SECRET
  });
  await fs.mkdir(TEMP_DIR, { recursive: true });

  const date = getTodayDateString();
  const doc = await getDayDoc(date);
  if (!doc?.posts?.length) {
    console.log('No day document for', date);
    return;
  }

  const post = doc.posts[index];
  if (!post) {
    console.log('No post at index', index);
    return;
  }
  if (post.status === 'posted') {
    console.log('Already posted:', post.character);
    return;
  }
  if (!post.imageUrl) {
    console.error('No imageUrl for post', index);
    await updatePostStatus(date, index, { status: 'error', error: 'No imageUrl' });
    return;
  }

  const character = { name: post.character, series: post.series };
  const tempPath = path.join(TEMP_DIR, `post_${date}_${index}_${Date.now()}.jpg`);

  try {
    await downloadPostImage(post.imageUrl, tempPath);
    const result = await postBirthdayTweet(character, tempPath, index, post.previewText);

    if (result.success && !result.skipped) {
      await updatePostStatus(date, index, {
        status: 'posted',
        postedAt: new Date().toISOString(),
        tweetUrl: result.url
      });
      console.log('Posted:', result.url);
    } else if (result.skipped) {
      console.log('Skipped:', result.reason);
    } else {
      await updatePostStatus(date, index, { status: 'error', error: result.error });
      console.error('Failed:', result.error);
    }
  } finally {
    try { await fs.unlink(tempPath); } catch (_) {}
  }
}

/**
 * Prepare posts with images — flujo determinista (mismo orden que post-now)
 * Ver src/image-resolver.js
 */
export async function preparePostsWithImages(characters) {
  const posts = [];

  for (const char of characters) {
    console.log(`\nPreparing post for ${char.name}...`);

    try {
      const malChar = await searchCharacter(char.name, char.series);
      const { imagePath, source } = await resolveImageForCharacter(char, malChar, TEMP_DIR, {
        hasAcdb: true,
        logSource: true
      });

      if (!imagePath) {
        console.log(`  No image for ${char.name}, skipping`);
        continue;
      }

      const seriesForTweet = (malChar?.anime?.[0]?.title) || char.series;
      posts.push({
        acdbId: char.id || null,
        character: {
          name: malChar?.name || char.name,
          name_kanji: malChar?.name_kanji || null,
          series: seriesForTweet,
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
    await sleep(500);
  }

  return posts;
}

export function sanitizeFilename(name) {
  return name
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 50);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
