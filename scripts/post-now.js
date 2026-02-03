/**
 * Post Now script - runs the full flow and posts immediately
 * Use this to manually trigger birthday posts
 */

import 'dotenv/config';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

import { getTodaysBirthdays } from '../src/scraper.js';
import { searchCharacter, downloadImage } from '../src/jikan.js';
import { initTwitterClient, postBirthdayTweet } from '../src/twitter.js';
import { validateImageFile } from '../src/image-validation.js';
import { searchImagesForCharacter, isGoogleImageSearchConfigured } from '../src/google-image-search.js';
import { getCharacterImage as getAnilistImage } from '../src/anilist.js';
import { searchCharacterImages as searchSafebooruImages } from '../src/safebooru.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEMP_DIR = path.join(__dirname, '..', 'temp');

// Parse command line arguments
const args = process.argv.slice(2);
const numPosts = parseInt(args.find(a => a.match(/^\d+$/)) || '1', 10);
const delaySeconds = parseInt(args.find(a => a.startsWith('--delay='))?.split('=')[1] || '30', 10);
const charFilter = args.find(a => a.startsWith('--char='))?.split('=')[1]?.trim(); // e.g. --char=Suguru

async function postNow() {
  console.log('===========================================');
  console.log('  Anime Birthday Bot - POST NOW');
  if (charFilter) {
    console.log(`  Posting character matching: "${charFilter}"`);
  } else {
    console.log(`  Posting ${numPosts} character(s)`);
  }
  console.log(`  Delay between posts: ${delaySeconds}s`);
  console.log('===========================================\n');

  // Validate config
  const required = ['API_KEY', 'API_SECRET', 'ACCESS_TOKEN', 'ACCESS_TOKEN_SECRET'];
  const missing = required.filter(key => !process.env[key]);
  if (missing.length > 0) {
    console.error('Missing environment variables:', missing.join(', '));
    process.exit(1);
  }

  // Initialize Twitter
  initTwitterClient({
    apiKey: process.env.API_KEY,
    apiSecret: process.env.API_SECRET,
    accessToken: process.env.ACCESS_TOKEN,
    accessTokenSecret: process.env.ACCESS_TOKEN_SECRET
  });

  // Ensure temp directory exists
  await fs.mkdir(TEMP_DIR, { recursive: true });

  console.log('Fetching today\'s birthdays...\n');

  try {
    let characters = await getTodaysBirthdays(charFilter ? 25 : numPosts);

    if (charFilter) {
      const needle = charFilter.toLowerCase();
      const match = characters.find(c => c.name.toLowerCase().includes(needle));
      if (!match) {
        console.log(`No character found matching "${charFilter}" in today's list.`);
        console.log('Available today:', characters.slice(0, 15).map(c => c.name).join(', '), '...');
        return;
      }
      characters = [match];
      console.log(`Found: ${match.name} (${match.series})\n`);
    }

    if (characters.length === 0) {
      console.log('No birthday characters found for today.');
      return;
    }

    if (!charFilter) {
      console.log(`Found ${characters.length} characters to post:\n`);
    }

    for (let i = 0; i < characters.length; i++) {
      const char = characters[i];
      console.log(`[${i + 1}/${characters.length}] ${char.name} (${char.series})`);

      // Search on MAL (para nombre y datos del tweet)
      const malChar = await searchCharacter(char.name, char.series);

      if (!malChar) {
        console.log('  Could not find on MAL, skipping...');
        continue;
      }

      let imagePath = null;

      // Prioridad 1: Anilist — imagen oficial (request directa)
      const anilistResult = await getAnilistImage(char.name, char.series);
      if (anilistResult?.url) {
        const imageFile = path.join(TEMP_DIR, `post_${Date.now()}_anilist.jpg`);
        imagePath = await downloadImage(anilistResult.url, imageFile);
        if (imagePath) {
          const validation = await validateImageFile(imagePath, malChar.name || char.name, char.series);
          if (validation.valid) {
            console.log('  Using image from Anilist');
          } else {
            try { await fs.unlink(imagePath); } catch (_) {}
            imagePath = null;
          }
        }
      }

      // Prioridad 2: Safebooru — imágenes por tags (request directa)
      if (!imagePath) {
        const safebooruResults = await searchSafebooruImages(char.name, char.series, 5);
        for (let j = 0; j < safebooruResults.length && !imagePath; j++) {
          const result = safebooruResults[j];
          const imageFile = path.join(TEMP_DIR, `post_${Date.now()}_safebooru_${j}.jpg`);
          const downloaded = await downloadImage(result.url, imageFile);
          if (downloaded) {
            const validation = await validateImageFile(downloaded, malChar.name || char.name, char.series);
            if (validation.valid) {
              imagePath = downloaded;
              console.log('  Using image from Safebooru');
            } else {
              try { await fs.unlink(downloaded); } catch (_) {}
            }
          }
          await new Promise(r => setTimeout(r, 200));
        }
      }

      // Prioridad 3 (si está configurado): Google Image Search
      if (!imagePath && isGoogleImageSearchConfigured()) {
        console.log('  Searching Google Images...');
        const googleResults = await searchImagesForCharacter(char.name, char.series, { num: 5, imgSize: 'large' });
        for (let j = 0; j < googleResults.length && !imagePath; j++) {
          const result = googleResults[j];
          const imageFile = path.join(TEMP_DIR, `post_${Date.now()}_google_${j}.jpg`);
          const downloaded = await downloadImage(result.url, imageFile);
          if (downloaded) {
            const validation = await validateImageFile(downloaded, malChar.name || char.name, char.series);
            if (validation.valid) {
              imagePath = downloaded;
              console.log('  Using image from Google Images');
            } else {
              try { await fs.unlink(downloaded); } catch (_) {}
            }
          }
          await new Promise(r => setTimeout(r, 200));
        }
      }

      // Prioridad 4: MAL
      if (!imagePath) {
        const imageFile = path.join(TEMP_DIR, `post_${Date.now()}.jpg`);
        imagePath = await downloadImage(malChar.image_large || malChar.image, imageFile);
      }

      if (!imagePath) {
        console.log('  Could not download image, skipping...');
        continue;
      }

      const validation = await validateImageFile(imagePath, malChar.name || char.name, char.series);
      if (!validation.valid) {
        console.log(`  Image validation failed: ${validation.reason}, skipping...`);
        try { await fs.unlink(imagePath); } catch (_) {}
        continue;
      }

      // Post tweet
      console.log('  Posting to Twitter...');
      const result = await postBirthdayTweet({
        name: malChar.name,
        series: char.series,
        birthday: char.birthday
      }, imagePath);

      if (result.success) {
        console.log(`  SUCCESS: ${result.url}`);
      } else {
        console.log(`  FAILED: ${result.error}`);
      }

      // Clean up image
      try {
        await fs.unlink(imagePath);
      } catch (e) {}

      // Wait between posts
      if (i < characters.length - 1) {
        console.log(`\n  Waiting ${delaySeconds} seconds...\n`);
        await new Promise(r => setTimeout(r, delaySeconds * 1000));
      }
    }

    console.log('\n===========================================');
    console.log('  POSTING COMPLETE');
    console.log('===========================================');

  } catch (error) {
    console.error('Error:', error);
  }
}

// Show usage if --help
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Usage: node scripts/post-now.js [count] [--delay=seconds]

Arguments:
  count         Number of characters to post (default: 1)
  --char=NAME   Post only the character whose name contains NAME (e.g. --char=Suguru)
  --delay=N     Seconds to wait between posts (default: 30)

Examples:
  node scripts/post-now.js                    # Post 1 character (first of day)
  node scripts/post-now.js --char=Suguru     # Post only character matching "Suguru"
  node scripts/post-now.js 3                  # Post top 3 characters
  node scripts/post-now.js 5 --delay=60      # Post 5 with 60s delay
`);
  process.exit(0);
}

postNow();
