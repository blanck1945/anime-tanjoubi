/**
 * Validación de que la imagen sea del personaje correcto:
 * - Tamaño y dimensiones mínimas (evitar placeholders/iconos)
 * - Opcional: Google Vision API para verificar que el contenido coincida con el personaje/serie
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sizeOf from 'image-size';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MIN_FILE_SIZE_BYTES = 25_000;   // 25 KB - descartar iconos/placeholders
const MIN_WIDTH = 280;
const MIN_HEIGHT = 280;

// URLs de ACDB que suelen ser placeholders o avatares genéricos (no bloqueamos 67712 en /uploads/chars/ porque a veces es válido)
const BAD_ACDB_PATTERNS = [
  /forum\/67712-/,            // placeholder conocido del foro
  /\/uploads\/1-\d+\.(jpg|png|gif)/i,  // uploads/1-xxxx (avatar por defecto)
];

/**
 * Indica si la URL parece un placeholder o imagen genérica (sin descargar).
 * @param {string} url
 * @returns {boolean} true = mejor no usar esta URL
 */
export function isUrlLikelyPlaceholder(url) {
  if (!url || typeof url !== 'string') return true;
  const lower = url.toLowerCase();
  if (lower.includes('icon') || lower.includes('default') || lower.includes('placeholder')) return true;
  return BAD_ACDB_PATTERNS.some(re => re.test(url));
}

/**
 * Extrae palabras significativas para buscar en texto (nombre/serie).
 * @param {string} text - ej. "Suguru Geto" o "Jujutsu Kaisen"
 * @returns {string[]} palabras en minúscula, sin números ni muy cortas
 */
function getSearchWords(text) {
  if (!text || typeof text !== 'string') return [];
  return text
    .toLowerCase()
    .replace(/[^\w\s\u00C0-\u024F]/g, ' ') // mantener acentos
    .split(/\s+/)
    .filter(w => w.length >= 2 && !/^\d+$/.test(w));
}

/**
 * Verifica con Google Vision API que la imagen "contenga" al personaje/serie.
 * Requiere GOOGLE_VISION_API_KEY en .env (opcional).
 * @param {string} imagePath - ruta local al archivo
 * @param {string} characterName
 * @param {string} series
 * @returns {Promise<{ valid: boolean, reason?: string }>}
 */
async function validateWithVisionApi(imagePath, characterName, series) {
  const apiKey = process.env.GOOGLE_VISION_API_KEY;
  if (!apiKey) return { valid: true }; // sin key no bloqueamos

  try {
    const buffer = await fs.readFile(imagePath);
    const base64 = buffer.toString('base64');

    const response = await axios.post(
      `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
      {
        requests: [{
          image: { content: base64 },
          features: [
            { type: 'WEB_DETECTION', maxResults: 15 },
            { type: 'LABEL_DETECTION', maxResults: 20 }
          ]
        }]
      },
      { timeout: 15_000 }
    );

    const res = response.data?.responses?.[0];
    if (!res) return { valid: true };

    const texts = [];
    if (res.labelAnnotations) {
      res.labelAnnotations.forEach(a => { if (a.description) texts.push(a.description); });
    }
    if (res.webDetection?.webEntities) {
      res.webDetection.webEntities.forEach(e => { if (e.description) texts.push(e.description); });
    }
    const combinedText = texts.join(' ').toLowerCase();

    const charWords = getSearchWords(characterName);
    const seriesWords = getSearchWords(series);

    const charMatches = charWords.filter(w => combinedText.includes(w));
    const seriesMatches = seriesWords.filter(w => combinedText.includes(w));

    // Exigir al menos 1 palabra del personaje Y (1 de la serie O 2 del personaje)
    const hasCharacter = charMatches.length >= 1;
    const hasSeries = seriesMatches.length >= 1;
    const hasStrongCharacter = charMatches.length >= 2;

    if (hasCharacter && (hasSeries || hasStrongCharacter)) {
      return { valid: true };
    }

    return {
      valid: false,
      reason: `Vision API: no se detectó personaje/serie en la imagen (buscado: "${characterName}", "${series}")`
    };
  } catch (err) {
    console.warn('[image-validation] Vision API error:', err.message);
    return { valid: true }; // ante error de API no bloqueamos
  }
}

/**
 * Valida que el archivo de imagen sea usable y (opcional) que corresponda al personaje.
 * @param {string} filePath - ruta al archivo de imagen
 * @param {string} characterName - nombre del personaje
 * @param {string} series - nombre de la serie
 * @returns {Promise<{ valid: boolean, reason?: string }>}
 */
export async function validateImageFile(filePath, characterName, series) {
  if (!filePath) return { valid: false, reason: 'No file path' };

  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return { valid: false, reason: 'Not a file' };
    if (stat.size < MIN_FILE_SIZE_BYTES) {
      return { valid: false, reason: `Imagen muy pequeña (${stat.size} bytes, mínimo ${MIN_FILE_SIZE_BYTES})` };
    }

    let dimensions;
    try {
      const buf = imagePathToBuffer(filePath);
      dimensions = sizeOf(buf);
    } catch (e) {
      return { valid: false, reason: 'No se pudo leer dimensiones de la imagen' };
    }

    if (!dimensions || !dimensions.width || !dimensions.height) {
      return { valid: false, reason: 'Dimensiones inválidas' };
    }
    if (dimensions.width < MIN_WIDTH || dimensions.height < MIN_HEIGHT) {
      return {
        valid: false,
        reason: `Imagen muy pequeña (${dimensions.width}x${dimensions.height}, mínimo ${MIN_WIDTH}x${MIN_HEIGHT})`
      };
    }

    const visionResult = await validateWithVisionApi(filePath, characterName, series);
    if (!visionResult.valid) return visionResult;

    return { valid: true };
  } catch (err) {
    return { valid: false, reason: err.message || 'Error validando imagen' };
  }
}

/**
 * image-size puede recibir buffer o path; en ESM a veces path falla, usamos buffer.
 */
function imagePathToBuffer(filePath) {
  return fsSync.readFileSync(filePath);
}

export default {
  validateImageFile,
  isUrlLikelyPlaceholder,
  MIN_FILE_SIZE_BYTES,
  MIN_WIDTH,
  MIN_HEIGHT
};
