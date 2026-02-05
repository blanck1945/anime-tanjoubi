/**
 * Post Now script - runs the full flow and posts immediately
 * Use this to manually trigger birthday posts
 */

import 'dotenv/config';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

import { getTodaysBirthdays } from '../src/scraper.js';
import { searchCharacter } from '../src/jikan.js';
import { initTwitterClient, postBirthdayTweet } from '../src/twitter.js';
import { resolveImageForCharacter } from '../src/image-resolver.js';
import { getDayDoc } from '../src/supabase.js';
import { downloadPostImage } from '../src/s3.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEMP_DIR = path.join(__dirname, '..', 'temp');
const ARGENTINA_TZ = 'America/Argentina/Buenos_Aires';

function getTodayDateString() {
  return new Date().toLocaleDateString('en-CA', { timeZone: ARGENTINA_TZ });
}

// Parse command line arguments
const args = process.argv.slice(2);
const numPosts = parseInt(args.find(a => a.match(/^\d+$/)) || '1', 10);
const delaySeconds = parseInt(args.find(a => a.startsWith('--delay='))?.split('=')[1] || '30', 10);
const charFilter = args.find(a => a.startsWith('--char='))?.split('=')[1]?.trim(); // e.g. --char=Suguru
const seriesArg = args.find(a => a.startsWith('--series='))?.slice('--series='.length).replace(/^["']|["']$/g, '').trim() || null;
// --message="..." : texto exacto del tweet (si no se pasa, se genera con Gemini/fallback)
const messageArg = args.find(a => a.startsWith('--message='));
const customMessage = messageArg ? messageArg.slice('--message='.length).replace(/^["']|["']$/g, '').trim() : null;

async function postNow() {
  console.log('===========================================');
  console.log('  Anime Birthday Bot - POST NOW');
  if (charFilter) {
    console.log(`  Posting character matching: "${charFilter}"`);
  } else {
    console.log(`  Posting ${numPosts} character(s)`);
  }
  if (customMessage) {
    console.log(`  Custom message: "${customMessage.slice(0, 50)}..."`);
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

  try {
    let characters;

    // Modo manual: --char + --series (+ opcional --message) sin depender de la lista del día
    if (charFilter && seriesArg) {
      console.log(`Using manual character: ${charFilter} (${seriesArg})\n`);
      characters = [{ name: charFilter, series: seriesArg, birthday: null }];
    } else {
      console.log('Fetching today\'s birthdays...\n');
      characters = await getTodaysBirthdays(charFilter ? 25 : numPosts);

      if (charFilter) {
        const needle = charFilter.toLowerCase();
        const match = characters.find(c => c.name.toLowerCase().includes(needle));
        if (!match) {
          console.log(`No character found matching "${charFilter}" in today's list.`);
          console.log('Tip: use --series="Anime Name" to post anyway with that character/series.\n');
          console.log('Available today:', characters.slice(0, 15).map(c => c.name).join(', '), '...');
          return;
        }
        characters = [match];
        console.log(`Found: ${match.name} (${match.series})\n`);
      }
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

      const malChar = await searchCharacter(char.name, char.series);
      if (!malChar) {
        console.log('  Could not find on MAL, skipping...');
        continue;
      }

      const displayName = malChar.name || char.name;
      let imagePath = null;

      // 1) Si hay post del día en Supabase para este personaje, usar ESA imagen (misma que en prep)
      if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
        try {
          const today = getTodayDateString();
          const dayDoc = await getDayDoc(today);
          const needle = displayName.toLowerCase();
          const match = dayDoc?.posts?.find(
            (p) => p.character && (p.character.toLowerCase().includes(needle) || needle.includes(p.character.toLowerCase()))
          );
          if (match?.imageUrl) {
            const tempFile = path.join(TEMP_DIR, `post_supabase_${Date.now()}.jpg`);
            await downloadPostImage(match.imageUrl, tempFile);
            imagePath = tempFile;
            console.log('  Using image from Supabase (same as prep)');
          }
        } catch (e) {
          // Si falla Supabase, seguimos con resolución determinista
        }
      }

      // 2) Si no había en Supabase: mismo flujo determinista que prep (image-resolver)
      if (!imagePath) {
        const resolved = await resolveImageForCharacter(char, malChar, TEMP_DIR, {
          hasAcdb: !!(char.image || char.thumbnail),
          logSource: true
        });
        imagePath = resolved.imagePath;
      }

      if (!imagePath) {
        console.log('  Could not get image, skipping...');
        continue;
      }

      // Post tweet
      console.log('  Posting to Twitter...');
      const result = await postBirthdayTweet(
        { name: malChar.name, series: char.series, birthday: char.birthday },
        imagePath,
        null,
        customMessage
      );

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
  --char=NAME   Post only the character whose name contains NAME (e.g. --char=Nishiki)
  --series=T    With --char, use this series to find image (post even if not in today's list)
  --message=T   Tweet text (use this exact text instead of generating)
  --delay=N     Seconds to wait between posts (default: 30)

Examples:
  node scripts/post-now.js                    # Post 1 character (first of day)
  node scripts/post-now.js --char=Nishiki --series="Tokyo Ghoul" --message="Happy birthday..."  # Custom text, any day
  node scripts/post-now.js 3                  # Post top 3 characters
  node scripts/post-now.js 5 --delay=60      # Post 5 with 60s delay
`);
  process.exit(0);
}

postNow();
