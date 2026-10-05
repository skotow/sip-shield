import { Router } from 'express';
import { db } from '../db.js';
import { sendTelegram } from '../services/telegram.js';
export const alerts = Router();
alerts.get('/settings', async (req, res) => {
  const rows = (await db.query('SELECT * FROM settings')).rows;
  const settings = Object.fromEntries(rows.map(row => [row.key,row.value]));
  res.json({ telegram_chat_id: settings.telegram_chat_id ?? process.env.TELEGRAM_CHAT_ID ?? '', telegram_token_configured: Boolean(settings.telegram_bot_token ?? process.env.TELEGRAM_BOT_TOKEN) });
});
alerts.post('/settings', async (req, res) => {
  for (const key of ['telegram_bot_token','telegram_chat_id']) {
    if (req.body[key] === undefined) continue;
    if (typeof req.body[key] !== 'string' || req.body[key].length > 512) throw new Error(`Invalid ${key}`);
    await db.query('INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value',[key,req.body[key]]);
  }
  res.json({ ok: true });
});
alerts.post('/alerts/test-telegram', async (req, res) => {
  const settings = Object.fromEntries((await db.query('SELECT * FROM settings')).rows.map(row => [row.key,row.value]));
  await sendTelegram(settings.telegram_bot_token ?? process.env.TELEGRAM_BOT_TOKEN, settings.telegram_chat_id ?? process.env.TELEGRAM_CHAT_ID);
  res.json({ ok: true });
});
