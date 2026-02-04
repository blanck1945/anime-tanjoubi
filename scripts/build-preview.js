/**
 * Prepara los top 6 personajes de una fecha, guarda imágenes de vista previa y estado.
 * Así la página "Vista previa" y "Planificado" muestran ese día.
 *
 * Uso: node scripts/build-preview.js [YYYY-MM-DD]
 * Ejemplo: node scripts/build-preview.js 2026-02-04
 */

import 'dotenv/config';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

import { getTodaysBirthdays } from '../src/scraper.js';
import { preparePostsWithImages } from '../index.js';
import { getBirthdayMessage } from '../src/twitter.js';
import { POST_TIMES } from '../src/scheduler.js';
import { saveState, DATA_DIR } from '../src/state.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NUM_POSTS = 6;

function formatTime(obj) {
  if (!obj) return 'N/A';
  return `${obj.hour.toString().padStart(2, '0')}:${obj.minute.toString().padStart(2, '0')}`;
}

async function main() {
  const dateStr = process.argv[2] || '2026-02-04';
  const date = new Date(dateStr + 'T12:00:00');
  if (isNaN(date.getTime())) {
    console.error('Fecha inválida. Uso: node scripts/build-preview.js YYYY-MM-DD');
    process.exit(1);
  }

  console.log(`\n=== Build preview para ${dateStr} (top ${NUM_POSTS}) ===\n`);

  const tempDir = path.join(path.dirname(__dirname), 'temp');
  await fs.mkdir(tempDir, { recursive: true });

  const characters = await getTodaysBirthdays(NUM_POSTS, date);
  if (characters.length === 0) {
    console.log('No hay personajes para esa fecha.');
    process.exit(1);
  }

  console.log(`Personajes: ${characters.map(c => c.name).join(', ')}\n`);

  const posts = await preparePostsWithImages(characters);
  if (posts.length === 0) {
    console.log('No se pudo preparar ningún post con imagen.');
    process.exit(1);
  }

  for (let i = 0; i < posts.length; i++) {
    posts[i].previewText = await getBirthdayMessage(posts[i].character);
  }

  const previewDir = path.join(DATA_DIR, 'preview', dateStr);
  await fs.mkdir(previewDir, { recursive: true });

  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];
    if (post.imagePath) {
      const ext = path.extname(post.imagePath) || '.jpg';
      const dest = path.join(previewDir, `${i}${ext}`);
      await fs.copyFile(post.imagePath, dest);
      console.log(`[Preview] ${i}.jpg → ${post.character.name}`);
    }
  }

  const state = {
    date: dateStr,
    preparedAt: new Date().toISOString(),
    posts: posts.map((post, index) => ({
      index,
      acdbId: post.acdbId ?? null,
      character: post.character.name,
      series: post.character.series,
      scheduledTime: formatTime(POST_TIMES[index]),
      status: 'pending',
      postedAt: null,
      tweetId: null,
      tweetUrl: null,
      previewText: post.previewText ?? null
    }))
  };

  await saveState(state);
  console.log(`\nEstado guardado: posts-${dateStr}.json`);
  console.log(`Preview: data/preview/${dateStr}/ (${posts.length} imágenes)`);
  console.log(`\nPodés ver: http://localhost:3000/vista-previa?date=${dateStr}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
