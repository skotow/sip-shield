import express from 'express';
import { createClient } from 'redis';
import { db } from './db.js';
import { customers } from './routes/customers.js';
import { rules } from './routes/rules.js';
import { events } from './routes/events.js';
import { sipSearch } from './routes/sip-search.js';
import { alerts } from './routes/alerts.js';
import { config } from './routes/config.js';
import { defense } from './routes/defense.js';
import { auth, requireAuth } from './auth.js';
import { readFile } from 'node:fs/promises';
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
const redis = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379', disableOfflineQueue: true });
redis.on('error', () => console.error('Redis connection error'));
redis.connect().catch(() => {});
await db.query(await readFile(new URL('../runtime.sql', import.meta.url),'utf8'));
app.get('/health', async (req, res) => {
  try { await db.query('SELECT 1'); await redis.ping(); res.json({ status: 'ok', postgres: 'ok', redis: 'ok' }); }
  catch { res.status(503).json({ status: 'unhealthy' }); }
});
app.use('/api/auth', auth);
app.use('/api', requireAuth);
app.use('/api/customers', customers);
app.use('/api/rules', rules);
app.use('/api', events, sipSearch, alerts, config, defense);
app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((error, req, res, next) => {
  const badRequest = error instanceof SyntaxError || !error.code || ['22P02','23503','23514','22007','22008'].includes(error.code);
  if(error.type==='entity.too.large')return res.status(413).json({error:'Upload is too large. CSV files must be at most 1 MiB.'});
  const status = error.code === '23505' ? 409 : badRequest ? 400 : 500;
  if (status === 500) console.error('Database request failed:', error.code);
  res.status(status).json({ error: status === 409 ? 'Value already exists' : error.code ? 'Invalid request or unavailable database' : error.message });
});
const server = app.listen(8080, '0.0.0.0', () => console.log('SIP Shield API listening on 8080'));
process.on('SIGTERM', () => server.close(async () => { await db.end(); await redis.quit(); process.exit(0); }));
