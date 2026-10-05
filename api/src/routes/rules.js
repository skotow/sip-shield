import { Router } from 'express';
import { db } from '../db.js';
import { id, text } from '../validation.js';
import { queueRuntime } from '../services/runtime.js';
export const rules = Router();
// Table and column names come only from this fixed map, never request data.
for (const [path, table, column] of [['blocked-ips','blocked_ips','ip_cidr'],['user-agents','blocked_user_agents','pattern'],['prefixes','blocked_prefixes','prefix']]) {
  rules.get(`/${path}`, async (req, res) => res.json((await db.query(`SELECT * FROM ${table} ORDER BY id DESC`)).rows));
  rules.post(`/${path}`, async (req, res) => {
    const values = [req.body.customer_id == null ? null : id(req.body.customer_id), text(req.body[column], column), req.body.reason ? text(req.body.reason, 'reason') : null];
    let extra = '';
    if (column === 'ip_cidr') {
      const expiry = req.body.expires_at || null;
      if (expiry && !Number.isFinite(Date.parse(expiry))) throw new Error('Invalid expires_at');
      const policy = req.body.policy || 'block';
      if (!['allow','block'].includes(policy)) throw new Error('Invalid IP policy');
      extra = ',expires_at,policy'; values.push(expiry,policy);
    }
    const result = await db.query(`INSERT INTO ${table}(customer_id,${column},reason${extra}) VALUES(${values.map((_, i) => `$${i+1}`).join(',')}) RETURNING *`, values);
    await queueRuntime(column === 'ip_cidr' ? 'permissions' : 'all');
    res.status(201).json(result.rows[0]);
  });
  rules.delete(`/${path}/:id`, async (req, res) => {
    const result = await db.query(`DELETE FROM ${table} WHERE id=$1`, [id(req.params.id)]);
    if (result.rowCount) await queueRuntime(column === 'ip_cidr' ? 'permissions' : 'all');
    res.status(result.rowCount ? 204 : 404).send();
  });
}
