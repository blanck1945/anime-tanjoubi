import 'dotenv/config';
import { getTodaysBirthdays } from '../src/scraper.js';
import { searchCharacter, downloadImage } from '../src/jikan.js';
import { createBirthdayMessage } from '../src/twitter.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testFlow() {
  console.log('=== Testing Birthday Flow (NO TWITTER POST) ===\n');

  // Step 1: Get today's birthdays
  console.log('1. Fetching birthdays from scraper...');
  const characters = await getTodaysBirthdays(3);

  console.log(`\nFound ${characters.length} characters:`);
  characters.forEach((char, i) => {
    console.log(`   ${i + 1}. "${char.name}" from "${char.series}"`);
  });

  // Step 2: Test Jikan search for first character
  if (characters.length > 0) {
    const testChar = characters[0];
    console.log(`\n2. Testing Jikan search for: "${testChar.name}"...`);

    const malChar = await searchCharacter(testChar.name, testChar.series);

    if (malChar) {
      console.log(`   ✅ Jikan found: ${malChar.name}`);
      console.log(`   MAL ID: ${malChar.mal_id}`);
      console.log(`   Image: ${malChar.image_large || malChar.image}`);
      console.log(`   Favorites: ${malChar.favorites}`);
    } else {
      console.log(`   ❌ Jikan could not find character`);
    }

    // Step 3: Test tweet message format
    console.log(`\n3. Testing tweet format:`);
    console.log('---');
    const message = createBirthdayMessage({
      name: malChar?.name || testChar.name,
      series: testChar.series,
      birthday: testChar.birthday
    });
    console.log(message);
    console.log('---');
    console.log(`Length: ${message.length}/280 characters`);
  }

  console.log('\n=== Test Complete ===');
}

testFlow().catch(console.error);
