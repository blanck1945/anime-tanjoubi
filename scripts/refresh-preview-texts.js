/**
 * Actualiza solo los textos de vista previa con Gemini (sin tocar imágenes).
 * Útil para ver los mensajes generados por IA sin volver a ejecutar build-preview.
 *
 * Uso: node scripts/refresh-preview-texts.js [YYYY-MM-DD]
 */

import 'dotenv/config';
import { loadState, saveState } from '../src/state.js';
import { getBirthdayMessage } from '../src/twitter.js';

async function main() {
  const dateStr = process.argv[2] || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
  console.log(`\nRefrescando textos de vista previa para ${dateStr}...\n`);

  const state = await loadState(dateStr);
  if (!state?.posts?.length) {
    console.error('No hay posts para esa fecha. Ejecutá antes: npm run build-preview', dateStr);
    process.exit(1);
  }

  for (let i = 0; i < state.posts.length; i++) {
    const post = state.posts[i];
    const character = { name: post.character, series: post.series };
    const text = await getBirthdayMessage(character);
    state.posts[i].previewText = text || post.previewText;
    console.log(`${i + 1}. ${post.character}: ${(state.posts[i].previewText || '').slice(0, 60)}...`);
  }

  await saveState(state);
  console.log(`\nListo. Actualizá la página: http://localhost:3000/vista-previa?date=${dateStr}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
