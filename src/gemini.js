/**
 * Google Gemini — generación de mensajes de cumpleaños para tweets.
 * Opcional: requiere GOOGLE_GEMINI_API_KEY en .env (https://aistudio.google.com/apikey).
 * Si no está configurado o falla, se usa createBirthdayMessage en twitter.js.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

const GEMINI_TIMEOUT_MS = 15_000;
const TWITTER_MAX_LENGTH = 280;

/**
 * Limpia la respuesta del modelo: quita markdown, comillas extra, recorta a 280.
 */
function cleanResponse(text) {
  if (!text || typeof text !== 'string') return '';
  let t = text
    .trim()
    .replace(/^```\w*\n?/g, '')
    .replace(/\n?```$/g, '')
    .replace(/^["']|["']$/g, '')
    .trim();
  if (t.length > TWITTER_MAX_LENGTH) {
    t = t.slice(0, TWITTER_MAX_LENGTH - 3) + '...';
  }
  return t;
}

/**
 * Asegura que los hashtags estén en un renglón abajo del texto (salto de línea antes del primer #).
 * Exportada para usarla también al publicar (twitter.js).
 */
export function ensureHashtagsOnNewLine(text) {
  if (!text || typeof text !== 'string') return text;
  const firstHash = text.indexOf('#');
  if (firstHash === -1) return text;
  // Si ya hay un salto de línea justo antes del primer #, no cambiar
  const before = text.slice(0, firstHash).trimEnd();
  if (before.endsWith('\n')) return text;
  return before + '\n\n' + text.slice(firstHash);
}

/**
 * Genera un mensaje de cumpleaños para un personaje usando Gemini.
 * @param {object} character - { name, series, birthday, about?, genres? }
 * @returns {Promise<string | null>} - Texto del tweet o null si no hay key, error o respuesta inválida
 */
export async function generateBirthdayMessage(character) {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) return null;

  const name = character.name || 'Character';
  const series = character.series || 'Anime';
  const birthday = character.birthday || '';
  const about = character.about
    ? String(character.about).slice(0, 500)
    : '';
  const genres = (character.genres || [])
    .slice(0, 3)
    .map(g => g.name || g)
    .join(', ');

  const prompt = `Write a single birthday tweet for this anime character. Rules:
- Character: ${name}
- Series: ${character.series}
- Birthday: ${birthday}
${about ? `- Short context (use only if helpful, do not copy verbatim): ${about}\n` : ''}${genres ? `- Genres: ${genres}\n` : ''}
- Write in natural, fluent English — like a real fan would post. Casual and warm, not stiff or robotic.
- Output: First line(s) = 1-2 short sentences (the birthday message). Then a line break. Next line = 5-8 relevant hashtags only (e.g. #SeriesName #CharacterName #AnimeBirthday #Anime #HappyBirthday). Do not mix text and hashtags on the same line.
- Maximum 280 characters total. No spoilers, no invented facts.
- Reply with ONLY the tweet text, no quotes, no explanation, no "Here is..." or similar.`;

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
      generationConfig: { maxOutputTokens: 150 }
    });

    const result = await Promise.race([
      model.generateContent(prompt),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Gemini timeout')), GEMINI_TIMEOUT_MS)
      )
    ]);

    const response = result?.response;
    if (!response) return null;

    const text = response.text?.();
    let cleaned = cleanResponse(text);
    if (!cleaned || cleaned.length > TWITTER_MAX_LENGTH) return null;

    cleaned = ensureHashtagsOnNewLine(cleaned);
    if (cleaned.length > TWITTER_MAX_LENGTH) {
      cleaned = cleaned.slice(0, TWITTER_MAX_LENGTH);
    }
    return cleaned;
  } catch (err) {
    console.warn('[Gemini]', err.message);
    return null;
  }
}

export default { generateBirthdayMessage };
