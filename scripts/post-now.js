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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEMP_DIR = path.join(__dirname, '..', 'temp');

// Parse command line arguments
const args = process.argv.slice(2);
const numPosts = parseInt(args.find(a => a.match(/^\d+$/)) || '1', 10);
const delaySeconds = parseInt(args.find(a => a.startsWith('--delay='))?.split('=')[1] || '30', 10);

async function postNow() {
  console.log('===========================================');
  console.log('  Anime Birthday Bot - POST NOW');
  console.log(`  Posting ${numPosts} character(s)`);
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
    const characters = await getTodaysBirthdays(numPosts);

    if (characters.length === 0) {
      console.log('No birthday characters found for today.');
      return;
    }

    console.log(`Found ${characters.length} characters to post:\n`);

    for (let i = 0; i < characters.length; i++) {
      const char = characters[i];
      console.log(`[${i + 1}/${characters.length}] ${char.name} (${char.series})`);

      // Search on MAL
      const malChar = await searchCharacter(char.name, char.series);

      if (!malChar) {
        console.log('  Could not find on MAL, skipping...');
        continue;
      }

      // Download image
      const imageFile = path.join(TEMP_DIR, `post_${Date.now()}.jpg`);
      const imagePath = await downloadImage(malChar.image_large || malChar.image, imageFile);

      if (!imagePath) {
        console.log('  Could not download image, skipping...');
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
  --delay=N     Seconds to wait between posts (default: 30)

Examples:
  node scripts/post-now.js              # Post 1 character
  node scripts/post-now.js 3            # Post top 3 characters
  node scripts/post-now.js 5 --delay=60 # Post 5 with 60s delay
`);
  process.exit(0);
}

postNow();
