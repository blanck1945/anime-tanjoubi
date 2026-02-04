/**
 * Publica un solo post a modo de prueba usando los datos ya preparados
 * (estado + imagen de vista previa). No re-descarga nada; publica exactamente
 * lo que ves en la página Vista previa.
 *
 * Uso: node scripts/post-preview-test.js [YYYY-MM-DD] [índice]
 *      node scripts/post-preview-test.js 2026-02-04 0   → publica el primero
 */

import 'dotenv/config';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

import { loadState, DATA_DIR } from '../src/state.js';
import { initTwitterClient, postBirthdayTweet } from '../src/twitter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const dateStr = process.argv[2] || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
  const index = parseInt(process.argv[3] || '0', 10);

  const required = ['API_KEY', 'API_SECRET', 'ACCESS_TOKEN', 'ACCESS_TOKEN_SECRET'];
  const missing = required.filter(key => !process.env[key]);
  if (missing.length > 0) {
    console.error('Faltan variables de entorno:', missing.join(', '));
    process.exit(1);
  }

  const state = await loadState(dateStr);
  if (!state?.posts?.length) {
    console.error(`No hay posts para ${dateStr}. Ejecutá antes: npm run build-preview ${dateStr}`);
    process.exit(1);
  }

  const post = state.posts[index];
  if (!post) {
    console.error(`No hay post en índice ${index}. Hay ${state.posts.length} posts (0-${state.posts.length - 1}).`);
    process.exit(1);
  }

  const previewDir = path.join(DATA_DIR, 'preview', dateStr);
  const files = await fs.readdir(previewDir).catch(() => []);
  const prefix = index + '.';
  const imgFile = files.find(f => f === String(index) || f.startsWith(prefix));
  if (!imgFile) {
    console.error(`No hay imagen de preview para índice ${index} en ${previewDir}`);
    process.exit(1);
  }

  const imagePath = path.join(previewDir, imgFile);
  const character = { name: post.character, series: post.series };
  const message = post.previewText;
  if (!message) {
    console.error('El post no tiene previewText en el estado.');
    process.exit(1);
  }

  initTwitterClient({
    apiKey: process.env.API_KEY,
    apiSecret: process.env.API_SECRET,
    accessToken: process.env.ACCESS_TOKEN,
    accessTokenSecret: process.env.ACCESS_TOKEN_SECRET
  });

  console.log('===========================================');
  console.log('  Post de prueba (Vista previa)');
  console.log('===========================================');
  console.log(`  Fecha: ${dateStr} | Índice: ${index}`);
  console.log(`  Personaje: ${post.character} (${post.series})`);
  console.log(`  Imagen: ${imagePath}`);
  console.log(`  Texto: ${message.slice(0, 80)}...`);
  console.log('===========================================\n');

  // postIndex = null para no marcar como enviado en el estado (es prueba)
  const result = await postBirthdayTweet(character, imagePath, null, message);

  if (result.success && !result.skipped) {
    console.log('\n  Publicado:', result.url);
  } else if (result.skipped) {
    console.log('\n  Omitido:', result.reason);
  } else {
    console.error('\n  Error:', result.error);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
