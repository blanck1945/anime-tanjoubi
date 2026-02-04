/**
 * Lista todos los personajes con cumpleaños hoy (un solo request, sin abrir fichas).
 * Uso: node scripts/list-birthdays.js
 */

import { getTodaysBirthdaysListOnly } from '../src/scraper.js';

async function main() {
  const characters = await getTodaysBirthdaysListOnly();
  console.log(JSON.stringify(characters, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
