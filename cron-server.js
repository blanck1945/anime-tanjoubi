/**
 * Servidor mínimo para cron externo (cron-job.org, etc.).
 * GET /run?token=SECRET&action=prep | action=post&index=N
 * Ejecuta node index.js --prep o --post=N como proceso hijo.
 */

import 'dotenv/config';
import http from 'http';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const CRON_SECRET = process.env.CRON_SECRET;

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function runAction(action, index) {
  return new Promise((resolve, reject) => {
    const args = action === 'prep' ? ['index.js', '--prep'] : ['index.js', `--post=${index}`];
    const child = spawn(process.execPath, args, {
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => { stdout += d.toString(); });
    child.stderr?.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => {
      if (code === 0) resolve({ ok: true, stdout, stderr });
      else reject(new Error(`exit ${code}: ${stderr || stdout}`));
    });
    child.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if (pathname === '/' || pathname === '/health') {
    send(res, 200, { status: 'ok' });
    return;
  }

  if (pathname !== '/run' || req.method !== 'GET') {
    send(res, 404, { ok: false, error: 'Not found' });
    return;
  }

  const token = url.searchParams.get('token');
  const action = url.searchParams.get('action');

  if (!CRON_SECRET || token !== CRON_SECRET) {
    send(res, 401, { ok: false, error: 'Unauthorized' });
    return;
  }

  if (action === 'prep') {
    try {
      await runAction('prep');
      send(res, 200, { ok: true, action: 'prep' });
    } catch (err) {
      send(res, 500, { ok: false, action: 'prep', error: err.message });
    }
    return;
  }

  if (action === 'post') {
    const indexStr = url.searchParams.get('index');
    const index = indexStr != null ? parseInt(indexStr, 10) : NaN;
    if (isNaN(index) || index < 0 || index > 6) {
      send(res, 400, { ok: false, error: 'index must be 0-6' });
      return;
    }
    try {
      await runAction('post', index);
      send(res, 200, { ok: true, action: 'post', index });
    } catch (err) {
      send(res, 500, { ok: false, action: 'post', index, error: err.message });
    }
    return;
  }

  send(res, 400, { ok: false, error: 'action must be prep or post' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Cron server listening on port ${PORT}`);
  console.log('GET /run?token=...&action=prep | action=post&index=0..6');
});
