import { randomUUID } from 'node:crypto';
import { db } from '../db.js';
export async function queueRuntime(kind = 'all') {
  const id = randomUUID();
  await db.query('INSERT INTO runtime_requests(id,kind) VALUES($1,$2)', [id,kind]);
  return { id, status: 'queued', message: 'Runtime table update queued; no process restart required' };
}
