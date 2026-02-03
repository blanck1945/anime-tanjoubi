import http from 'http';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { getCurrentState, loadState, canRecoverFromState } from './state.js';
import { getScheduledJobs } from './scheduler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Misma lógica que state.js para el directorio de datos
const DATA_DIR = process.env.RAILWAY_ENVIRONMENT
  ? '/data'
  : path.join(__dirname, '..', 'data');

const PORT = process.env.PORT || 3000;

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
 * Get status emoji and text
 */
function getStatusDisplay(status) {
  switch (status) {
    case 'posted':
      return { emoji: '✅', text: 'Enviado', color: '#22c55e' };
    case 'error':
      return { emoji: '❌', text: 'Error', color: '#ef4444' };
    case 'pending':
    default:
      return { emoji: '⏳', text: 'Pendiente', color: '#f59e0b' };
  }
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
          const status = getStatusDisplay(post.status);
          return `
          <tr>
            <td>${i + 1}</td>
            <td>
              <div class="character-name">${escapeHtml(post.character)}</div>
              <div class="series-name">${escapeHtml(post.series)}</div>
            </td>
            <td>${post.scheduledTime}</td>
            <td>
              <span class="status-badge status-${post.status}">
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
      <p style="margin-top: 5px;">Bot activo | ${jobs.length} jobs programados</p>
    </footer>
  </div>
</body>
</html>
  `;

  return html;
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
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(state, null, 2));
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
      res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
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
