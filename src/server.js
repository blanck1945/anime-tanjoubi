import http from 'http';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getCurrentState, loadState, canRecoverFromState, getAvailableDates } from './state.js';
import { getScheduledJobs } from './scheduler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let appVersion = '0.0.0';
try {
  const pkgPath = path.join(__dirname, '..', 'package.json');
  appVersion = JSON.parse(fsSync.readFileSync(pkgPath, 'utf-8')).version || appVersion;
} catch (_) {}

// Misma lógica que state.js para el directorio de datos
const DATA_DIR = process.env.RAILWAY_ENVIRONMENT
  ? '/data'
  : path.join(__dirname, '..', 'data');

const PORT = process.env.PORT || 3000;
const ARGENTINA_TZ = 'America/Argentina/Buenos_Aires';

/**
 * Indica si la hora programada ya pasó (según hora Argentina).
 * @param {string} stateDate - YYYY-MM-DD
 * @param {string} scheduledTime - "HH:MM" o "HH:MM:SS"
 */
function scheduledTimeHasPassed(stateDate, scheduledTime) {
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: ARGENTINA_TZ });
  if (stateDate < todayStr) return true;
  if (stateDate > todayStr) return false;
  const [h, m] = (scheduledTime || '00:00').split(':').map(Number);
  const now = new Date();
  const nowHour = parseInt(now.toLocaleString('en-US', { timeZone: ARGENTINA_TZ, hour: 'numeric', hour12: false }), 10);
  const nowMinute = parseInt(now.toLocaleString('en-US', { timeZone: ARGENTINA_TZ, minute: '2-digit' }), 10);
  return nowHour > h || (nowHour === h && nowMinute >= (m || 0));
}

/**
 * Estado para mostrar en planificación: si la hora ya pasó y sigue pendiente → "Enviando"; si no → "Programado".
 */
function getPlanStatusDisplay(post, stateDate) {
  if (post.status === 'posted') return { label: 'Enviado', class: 'status-posted', emoji: '✅' };
  if (post.status === 'error') return { label: 'Error', class: 'status-error', emoji: '❌' };
  if (post.status === 'pending') {
    const passed = scheduledTimeHasPassed(stateDate, post.scheduledTime);
    return passed
      ? { label: 'Enviando', class: 'status-sending', emoji: '📤' }
      : { label: 'Programado', class: 'status-pending', emoji: '⏳' };
  }
  return { label: 'Pendiente', class: 'status-pending', emoji: '⏳' };
}

/**
 * Format date for display
 */
function formatDate(dateString) {
  if (!dateString) return 'N/A';
  const date = new Date(dateString);
  return date.toLocaleString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
}

/**
 * Format full date for header
 */
function formatFullDate(dateString) {
  if (!dateString) return 'Sin fecha';
  const date = new Date(dateString + 'T12:00:00');
  return date.toLocaleDateString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
}

/**
 * Get status emoji and text (dashboard). Si la hora ya pasó y está pendiente → "Enviando".
 */
function getStatusDisplay(post, stateDate) {
  if (!stateDate || !post) {
    const s = typeof post === 'string' ? post : (post && post.status);
    if (s === 'posted') return { emoji: '✅', text: 'Enviado', color: '#22c55e' };
    if (s === 'error') return { emoji: '❌', text: 'Error', color: '#ef4444' };
    return { emoji: '⏳', text: 'Pendiente', color: '#f59e0b' };
  }
  const plan = getPlanStatusDisplay(post, stateDate);
  const colors = { 'status-posted': '#22c55e', 'status-error': '#ef4444', 'status-sending': '#3b82f6', 'status-pending': '#f59e0b' };
  return { emoji: plan.emoji, text: plan.label, color: colors[plan.class] || '#f59e0b' };
}

/**
 * Generate HTML dashboard
 */
async function generateDashboard() {
  const state = await getCurrentState();
  const jobs = getScheduledJobs();

  const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="refresh" content="30">
  <title>Anime Birthday Bot - Dashboard</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      min-height: 100vh;
      color: #e0e0e0;
      padding: 20px;
    }
    .container {
      max-width: 900px;
      margin: 0 auto;
    }
    header {
      text-align: center;
      margin-bottom: 30px;
      padding: 20px;
      background: rgba(255,255,255,0.05);
      border-radius: 16px;
      border: 1px solid rgba(255,255,255,0.1);
    }
    h1 {
      font-size: 2rem;
      color: #ff6b9d;
      margin-bottom: 10px;
    }
    .date {
      font-size: 1.1rem;
      color: #8b8b8b;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 15px;
      margin-bottom: 30px;
    }
    .stat-card {
      background: rgba(255,255,255,0.05);
      padding: 20px;
      border-radius: 12px;
      text-align: center;
      border: 1px solid rgba(255,255,255,0.1);
    }
    .stat-value {
      font-size: 2.5rem;
      font-weight: bold;
    }
    .stat-label {
      font-size: 0.9rem;
      color: #8b8b8b;
      margin-top: 5px;
    }
    .stat-posted { color: #22c55e; }
    .stat-pending { color: #f59e0b; }
    .stat-error { color: #ef4444; }
    table {
      width: 100%;
      border-collapse: collapse;
      background: rgba(255,255,255,0.05);
      border-radius: 12px;
      overflow: hidden;
      border: 1px solid rgba(255,255,255,0.1);
    }
    th {
      background: rgba(255,107,157,0.2);
      padding: 15px 12px;
      text-align: left;
      font-weight: 600;
      color: #ff6b9d;
    }
    td {
      padding: 12px;
      border-bottom: 1px solid rgba(255,255,255,0.05);
    }
    tr:last-child td {
      border-bottom: none;
    }
    tr:hover {
      background: rgba(255,255,255,0.03);
    }
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 0.85rem;
      font-weight: 500;
    }
    .status-posted { background: rgba(34,197,94,0.2); color: #22c55e; }
    .status-pending { background: rgba(245,158,11,0.2); color: #f59e0b; }
    .status-sending { background: rgba(59,130,246,0.2); color: #3b82f6; }
    .status-error { background: rgba(239,68,68,0.2); color: #ef4444; }
    .tweet-link {
      color: #60a5fa;
      text-decoration: none;
    }
    .tweet-link:hover {
      text-decoration: underline;
    }
    .character-name {
      font-weight: 500;
      color: #fff;
    }
    .series-name {
      font-size: 0.85rem;
      color: #8b8b8b;
    }
    footer {
      text-align: center;
      margin-top: 30px;
      color: #666;
      font-size: 0.85rem;
    }
    .refresh-note {
      color: #666;
      margin-top: 10px;
    }
    .no-posts {
      text-align: center;
      padding: 40px;
      color: #8b8b8b;
    }
    @media (max-width: 600px) {
      .stats { grid-template-columns: 1fr; }
      th, td { padding: 10px 8px; font-size: 0.9rem; }
      h1 { font-size: 1.5rem; }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>🎂 Anime Birthday Bot</h1>
      <p class="date">${formatFullDate(state.date)}</p>
      ${state.preparedAt ? `<p class="refresh-note">Preparado: ${formatDate(state.preparedAt)}</p>` : ''}
    </header>

    ${state.posts.length > 0 ? `
    <div class="stats">
      <div class="stat-card">
        <div class="stat-value stat-posted">${state.posts.filter(p => p.status === 'posted').length}</div>
        <div class="stat-label">Enviados</div>
      </div>
      <div class="stat-card">
        <div class="stat-value stat-pending">${state.posts.filter(p => p.status === 'pending').length}</div>
        <div class="stat-label">Pendientes</div>
      </div>
      <div class="stat-card">
        <div class="stat-value stat-error">${state.posts.filter(p => p.status === 'error').length}</div>
        <div class="stat-label">Errores</div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Personaje</th>
          <th>Hora</th>
          <th>Estado</th>
          <th>Posteado</th>
          <th>Link</th>
        </tr>
      </thead>
      <tbody>
        ${state.posts.map((post, i) => {
          const status = getStatusDisplay(post, state.date);
          const badgeClass = post.status === 'pending' && scheduledTimeHasPassed(state.date, post.scheduledTime) ? 'status-sending' : `status-${post.status}`;
          return `
          <tr>
            <td>${i + 1}</td>
            <td>
              <div class="character-name">${escapeHtml(post.character)}</div>
              <div class="series-name">${escapeHtml(post.series)}</div>
            </td>
            <td>${post.scheduledTime}</td>
            <td>
              <span class="status-badge ${badgeClass}">
                ${status.emoji} ${status.text}
              </span>
            </td>
            <td>${post.postedAt ? formatDate(post.postedAt) : '-'}</td>
            <td>
              ${post.tweetUrl
                ? `<a href="${post.tweetUrl}" target="_blank" class="tweet-link">Ver tweet</a>`
                : '-'}
            </td>
          </tr>
          `;
        }).join('')}
      </tbody>
    </table>
    ` : `
    <div class="no-posts">
      <p>No hay posts programados para hoy.</p>
      <p style="margin-top: 10px;">Los posts se preparan a las 8:30 AM (Argentina).</p>
    </div>
    `}

    <footer>
      <p>Auto-refresh cada 30 segundos</p>
      <p style="margin-top: 5px;">Bot activo | ${jobs.length} jobs programados | v${appVersion}</p>
      <p style="margin-top: 8px;"><a href="/planificado" style="color: #60a5fa;">Planificado</a> · <a href="/vista-previa" style="color: #60a5fa;">Vista previa (cómo queda cada post antes de publicar)</a></p>
    </footer>
  </div>
</body>
</html>
  `;

  return html;
}

/**
 * Página Planificado: lo programado por fecha (últimos 7 días en /data)
 */
async function generatePlanificadoPage(dates, selectedDate, state) {
  const baseStyle = `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', system-ui, sans-serif; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); min-height: 100vh; color: #e0e0e0; padding: 20px; }
    .container { max-width: 900px; margin: 0 auto; }
    header { text-align: center; margin-bottom: 24px; padding: 20px; background: rgba(255,255,255,0.05); border-radius: 16px; }
    h1 { font-size: 1.75rem; color: #ff6b9d; margin-bottom: 8px; }
    a { color: #60a5fa; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .nav { margin-bottom: 20px; }
    select { padding: 8px 12px; border-radius: 8px; background: rgba(255,255,255,0.1); color: #e0e0e0; border: 1px solid rgba(255,255,255,0.2); cursor: pointer; }
    table { width: 100%; border-collapse: collapse; background: rgba(255,255,255,0.05); border-radius: 12px; overflow: hidden; border: 1px solid rgba(255,255,255,0.1); }
    th { background: rgba(255,107,157,0.2); padding: 12px; text-align: left; color: #ff6b9d; }
    td { padding: 12px; border-bottom: 1px solid rgba(255,255,255,0.05); }
    tr:last-child td { border-bottom: none; }
    .status-posted { color: #22c55e; }
    .status-pending { color: #f59e0b; }
    .status-sending { color: #3b82f6; }
    .status-error { color: #ef4444; }
    .no-posts { text-align: center; padding: 40px; color: #8b8b8b; }
  `;
  const options = dates.map(d => `<option value="${d}" ${d === selectedDate ? 'selected' : ''}>${formatFullDate(d)} (${d})</option>`).join('');
  const rows = (state?.posts || []).map((post, i) => {
    const plan = getPlanStatusDisplay(post, selectedDate);
    return `<tr>
      <td>${i + 1}</td>
      <td><strong>${escapeHtml(post.character)}</strong><br><span style="color:#8b8b8b;font-size:0.9em">${escapeHtml(post.series)}</span></td>
      <td>${post.scheduledTime}</td>
      <td class="${plan.class}">${plan.emoji} ${plan.label}</td>
      <td>${post.postedAt ? formatDate(post.postedAt) : '-'}</td>
      <td>${post.tweetUrl ? `<a href="${escapeHtml(post.tweetUrl)}" target="_blank">Ver tweet</a>` : '-'}</td>
    </tr>`;
  }).join('');
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Planificado</title><style>${baseStyle}</style></head>
<body>
  <div class="container">
    <header>
      <h1>📅 Planificado</h1>
      <p style="color:#8b8b8b">Lo programado (guardado 7 días en /data)</p>
      <p style="margin-top:8px"><a href="/">← Dashboard</a> · <a href="/vista-previa?date=${selectedDate}">Ver cómo quedaría cada post (foto + texto)</a></p>
    </header>
    <div class="nav">
      <label>Fecha: </label>
      <select onchange="location.href='/planificado?date='+this.value">${options}</select>
    </div>
    ${state?.posts?.length ? `
    <table>
      <thead><tr><th>#</th><th>Personaje</th><th>Hora</th><th>Estado</th><th>Enviado</th><th>Link</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ` : `<div class="no-posts">No hay posts para esta fecha.</div>`}
  </div>
</body>
</html>`;
}

/**
 * Página Vista previa: cómo quedaría cada post (mockup de tweet)
 */
async function generateVistaPreviaPage(dates, selectedDate, state) {
  const baseStyle = `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', system-ui, sans-serif; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); min-height: 100vh; color: #e0e0e0; padding: 20px; }
    .container { max-width: 600px; margin: 0 auto; }
    header { text-align: center; margin-bottom: 24px; padding: 20px; background: rgba(255,255,255,0.05); border-radius: 16px; }
    h1 { font-size: 1.75rem; color: #ff6b9d; margin-bottom: 8px; }
    a { color: #60a5fa; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .nav { margin-bottom: 20px; }
    select { padding: 8px 12px; border-radius: 8px; background: rgba(255,255,255,0.1); color: #e0e0e0; border: 1px solid rgba(255,255,255,0.2); cursor: pointer; }
    .tweet-mock { background: #15202b; border: 1px solid #38444d; border-radius: 16px; padding: 16px; margin-bottom: 16px; }
    .tweet-mock .text { white-space: pre-wrap; word-break: break-word; margin-bottom: 12px; line-height: 1.4; }
    .tweet-mock img { max-width: 100%; border-radius: 12px; display: block; }
    .tweet-mock .meta { color: #8b8b8b; font-size: 0.85em; margin-top: 8px; }
    .tweet-mock .no-image { background: rgba(255,255,255,0.05); border: 1px dashed #555; border-radius: 12px; padding: 24px; text-align: center; color: #8b8b8b; font-size: 0.9em; margin-top: 8px; }
    .no-posts { text-align: center; padding: 40px; color: #8b8b8b; }
  `;
  const options = dates.map(d => `<option value="${d}" ${d === selectedDate ? 'selected' : ''}>${formatFullDate(d)} (${d})</option>`).join('');
  const posts = state?.posts || [];
  const cards = posts.map((post, i) => {
    const text = post.previewText || `🎂 Happy Birthday to ${escapeHtml(post.character)}! 🎉\n\nFrom ${escapeHtml(post.series)}.`;
    const imgUrl = `/preview-image/${selectedDate}/${i}`;
    return `<div class="tweet-mock">
      <div class="text">${escapeHtml(text).replace(/\n/g, '<br>')}</div>
      <img src="${imgUrl}" alt="" width="400" onerror="this.style.display='none'; var n=this.nextElementSibling; if(n) n.style.display='block';" />
      <div class="no-image" style="display:none;">Imagen no disponible aún (se guarda cuando el bot hace la preparación del día)</div>
      <div class="meta">Post #${i + 1} · ${post.scheduledTime} · ${post.character}</div>
    </div>`;
  }).join('');
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Vista previa</title><style>${baseStyle}</style></head>
<body>
  <div class="container">
    <header>
      <h1>👁 Vista previa</h1>
      <p style="color:#8b8b8b">Así quedaría cada post <strong>antes de publicar</strong> (texto + foto). Sirve para corroborar que la foto es la correcta.</p>
      <p style="color:#6b7280; font-size:0.9em; margin-top:6px;">Las imágenes se guardan cuando el bot hace la preparación del día (7 días en /data).</p>
      <p style="margin-top:10px"><a href="/">← Dashboard</a> · <a href="/planificado?date=${selectedDate}">Ver planificado</a></p>
    </header>
    <div class="nav">
      <label>Fecha: </label>
      <select onchange="location.href='/vista-previa?date='+this.value">${options}</select>
    </div>
    ${cards || '<div class="no-posts">No hay posts para esta fecha.</div>'}
  </div>
</body>
</html>`;
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Start the HTTP server
 */
export function startServer() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (url.pathname === '/api/status') {
      // JSON API endpoint
      try {
        const state = await getCurrentState();
        const body = { version: appVersion, ...state };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body, null, 2));
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
    } else if (url.pathname === '/api/jobs') {
      // Scheduled jobs endpoint
      try {
        const jobs = getScheduledJobs();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(jobs, null, 2));
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
    } else if (url.pathname === '/health') {
      // Health check endpoint
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', version: appVersion, timestamp: new Date().toISOString() }));
    } else if (url.pathname === '/api/state-check') {
      // Diagnóstico: por qué se recupera o no el estado
      try {
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
        const state = await loadState(today);
        const canRecover = await canRecoverFromState(today);

        let dataDirExists = false;
        let dataDirWritable = false;
        let filesInData = [];
        let dataDirError = null;

        try {
          await fs.access(DATA_DIR);
          dataDirExists = true;
          const files = await fs.readdir(DATA_DIR);
          filesInData = files.filter(f => f.endsWith('.json'));
          const testFile = path.join(DATA_DIR, '.write-test-' + Date.now());
          await fs.writeFile(testFile, 'ok', 'utf-8');
          await fs.unlink(testFile);
          dataDirWritable = true;
        } catch (e) {
          dataDirError = e.code || e.message;
        }

        const payload = {
          version: appVersion,
          today,
          dataDir: DATA_DIR,
          railway: !!process.env.RAILWAY_ENVIRONMENT,
          dataDirExists,
          dataDirWritable,
          dataDirError,
          filesInData,
          stateExists: !!state,
          statePostsCount: state?.posts?.length ?? 0,
          canRecoverFromState: canRecover,
          reason: canRecover
            ? 'Hay estado de hoy con acdbId → al arrancar se recuperan los mismos personajes (no re-scrape).'
            : !state
              ? 'No hay archivo de estado para hoy → al arrancar se scrapea de nuevo.'
              : !state.posts?.every(p => p.acdbId)
                ? 'El estado no tiene acdbId en todos los posts (estado viejo o primera vez) → se scrapea.'
                : 'Estado sin posts o vacío.',
          postsWithAcdbId: state?.posts?.filter(p => p.acdbId).length ?? 0,
          postsPosted: state?.posts?.filter(p => p.status === 'posted').length ?? 0
        };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload, null, 2));
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message, stack: error.stack }));
      }
    } else if (url.pathname === '/planificado') {
      try {
        let dates = await getAvailableDates();
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
        if (dates.length === 0) dates = [today];
        const selectedDate = url.searchParams.get('date') || dates[0] || today;
        const state = await loadState(selectedDate);
        const html = await generatePlanificadoPage(dates, selectedDate, state);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`Error: ${error.message}`);
      }
    } else if (url.pathname === '/vista-previa') {
      try {
        let dates = await getAvailableDates();
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
        if (dates.length === 0) dates = [today];
        const selectedDate = url.searchParams.get('date') || dates[0] || today;
        const state = await loadState(selectedDate);
        const html = await generateVistaPreviaPage(dates, selectedDate, state);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`Error: ${error.message}`);
      }
    } else if (url.pathname.startsWith('/preview-image/')) {
      const parts = url.pathname.replace('/preview-image/', '').split('/');
      const date = parts[0];
      const index = parts[1];
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || index === undefined) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Bad request');
        return;
      }
      const previewDir = path.join(DATA_DIR, 'preview', date);
      let found = false;
      try {
        const files = await fs.readdir(previewDir);
        const prefix = index.includes('.') ? index : index + '.';
        const match = files.find(f => f === index || f.startsWith(prefix));
        if (match) {
          const filePath = path.join(previewDir, match);
          const data = await fs.readFile(filePath);
          const ext = path.extname(match).toLowerCase();
          const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'image/jpeg';
          res.writeHead(200, { 'Content-Type': mime });
          res.end(data);
          found = true;
        }
      } catch (e) {
        if (e.code !== 'ENOENT') console.warn('[preview-image]', e.message);
      }
      if (!found) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
      }
    } else {
      // Dashboard HTML
      try {
        const html = await generateDashboard();
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`Error: ${error.message}`);
      }
    }
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Dashboard server running at http://localhost:${PORT}`);
    console.log(`API: http://localhost:${PORT}/api/status | Diagnóstico estado: http://localhost:${PORT}/api/state-check`);
  });

  return server;
}

export default {
  startServer
};
