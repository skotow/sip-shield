import { Router, text as csvBody } from 'express';
import { db } from '../db.js';
import { id, text } from '../validation.js';
import { queueRuntime } from '../services/runtime.js';
import {readPrefixCsv} from '../prefix-csv.js';
export const rules = Router();
rules.post('/prefixes/import',csvBody({type:['text/csv','text/plain','application/csv'],limit:'1mb'}),async(req,res)=>{
  const parsed=readPrefixCsv(req.body);
  const customerId=req.query.customer_id ? id(req.query.customer_id) : null;
  const client=await db.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout='5s'");
    if(customerId && !(await client.query('SELECT id FROM customers WHERE id=$1 FOR KEY SHARE',[customerId])).rowCount)throw new Error('Selected customer no longer exists');
    // Serialize imports and ordinary edits to skip duplicates without races.
    await client.query('LOCK TABLE blocked_prefixes IN SHARE ROW EXCLUSIVE MODE');
    const inserted=await client.query(`INSERT INTO blocked_prefixes(customer_id,prefix,reason)
      SELECT $1,input.prefix,input.reason FROM unnest($2::text[],$3::text[]) AS input(prefix,reason)
      WHERE NOT EXISTS (SELECT 1 FROM blocked_prefixes existing WHERE existing.customer_id IS NOT DISTINCT FROM $1::int AND existing.prefix=input.prefix)`,
      [customerId,parsed.rows.map(row=>row.prefix),parsed.rows.map(row=>row.reason)]);
    const reload=inserted.rowCount ? await queueRuntime('all',client) : null;
    await client.query('COMMIT');
    res.status(201).json({imported:inserted.rowCount,skipped:parsed.records-inserted.rowCount,customer_id:customerId,reload_id:reload?.id??null,message:reload?'Prefixes imported. Runtime update queued.':'No new prefixes; duplicates skipped.'});
  }catch(error){await client.query('ROLLBACK');throw error;}
  finally{client.release();}
});
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
