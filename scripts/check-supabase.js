/**
 * Verifica que Supabase esté conectado y muestra los registros en daily_posts.
 * Uso: node scripts/check-supabase.js
 */

import 'dotenv/config';
import { getAvailableDates, getDayDoc, closeMongo } from '../src/supabase.js';

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY deben estar en .env');
    process.exit(1);
  }
  console.log('Conectando a Supabase...\n');

  try {
    const dates = await getAvailableDates(20);
    if (dates.length === 0) {
      console.log('Tabla daily_posts: vacía (aún no se guardó ningún día).');
      console.log('La tabla se llena al correr: node index.js --prep');
      return;
    }

    console.log(`Fechas con datos (${dates.length}):`, dates.join(', '));
    console.log('');

    for (const date of dates.slice(0, 3)) {
      const doc = await getDayDoc(date);
      if (!doc) continue;
      const n = doc.posts?.length ?? 0;
      console.log(`--- ${date} (${n} posts) ---`);
      doc.posts?.forEach((p, i) => {
        console.log(`  ${i}. ${p.character} (${p.series}) | ${p.status} | ${p.imageUrl ? 'imagen OK' : 'sin imagen'}`);
      });
      console.log('');
    }

    console.log('Supabase OK: tabla daily_posts existe.');
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    await closeMongo();
  }
}

main();
