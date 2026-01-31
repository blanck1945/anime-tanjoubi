/**
 * Dry-run script - tests the full flow without posting to Twitter
 * Use this to verify scraping and image downloading works correctly
 */

import 'dotenv/config';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

import { getTodaysBirthdays } from '../src/scraper.js';
import { searchCharacter, downloadImage } from '../src/jikan.js';
import { createBirthdayMessage } from '../src/twitter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEMP_DIR = path.join(__dirname, '..', 'temp');

async function dryRun() {
  console.log('===========================================');
  console.log('  Anime Birthday Bot - DRY RUN');
  console.log('  (No tweets will be posted)');
  console.log('===========================================\n');

  // Ensure temp directory exists
  await fs.mkdir(TEMP_DIR, { recursive: true });

  console.log('Step 1: Fetching today\'s birthdays...\n');

  try {
    const characters = await getTodaysBirthdays(5);

    if (characters.length === 0) {
      console.log('No birthday characters found for today.');
      return;
    }

    console.log(`Found ${characters.length} birthday characters:\n`);

    for (let i = 0; i < characters.length; i++) {
      const char = characters[i];
      console.log(`--- Character ${i + 1} ---`);
      console.log(`Name: ${char.name}`);
      console.log(`Series: ${char.series}`);
      console.log(`Favorites: ${char.favorites || 'N/A'}`);
      console.log(`Database URL: ${char.url}`);
      console.log(`Thumbnail: ${char.thumbnail}`);

      // Search on MAL
      console.log('\nSearching on MyAnimeList...');
      const malChar = await searchCharacter(char.name, char.series);

      if (malChar) {
        console.log(`  MAL Name: ${malChar.name}`);
        console.log(`  MAL Kanji: ${malChar.name_kanji || 'N/A'}`);
        console.log(`  MAL Favorites: ${malChar.favorites}`);
        console.log(`  MAL Image: ${malChar.image_large || malChar.image}`);

        // Download image
        const imageFile = path.join(TEMP_DIR, `test_${i + 1}.jpg`);
        const downloaded = await downloadImage(malChar.image_large || malChar.image, imageFile);

        if (downloaded) {
          console.log(`  Image downloaded to: ${imageFile}`);
        } else {
          console.log(`  Failed to download image`);
        }

        // Generate tweet message
        const message = createBirthdayMessage({
          name: malChar.name,
          series: char.series,
          birthday: char.birthday
        });

        console.log('\n  Generated tweet:');
        console.log('  ---');
        console.log(`  ${message.split('\n').join('\n  ')}`);
        console.log('  ---');
        console.log(`  Characters: ${message.length}/280`);
      } else {
        console.log('  Not found on MAL');

        // Fallback to database thumbnail
        if (char.thumbnail) {
          const imageFile = path.join(TEMP_DIR, `test_${i + 1}_thumb.jpg`);
          const downloaded = await downloadImage(char.thumbnail, imageFile);
          console.log(`  Thumbnail downloaded: ${downloaded ? 'Yes' : 'No'}`);
        }
      }

      console.log('\n');

      // Rate limit
      await new Promise(r => setTimeout(r, 500));
    }

    console.log('===========================================');
    console.log('  DRY RUN COMPLETE');
    console.log(`  Images saved to: ${TEMP_DIR}`);
    console.log('===========================================');

  } catch (error) {
    console.error('Error during dry run:', error);
  }
}

dryRun();
