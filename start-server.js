/**
 * Arranca el servidor dashboard (vista previa, planificado) + endpoint /run para cron externo.
 * Railway: node start-server.js
 */

import 'dotenv/config';
import { startServer } from './src/server.js';

startServer();
