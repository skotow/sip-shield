import { Router } from 'express';
import { db } from '../db.js';
import { id, text } from '../validation.js';
import { queueRuntime } from '../services/runtime.js';
export const defense = Router();
export function behavior(body) {
  if (!['invite','register','options','response_404','response_403'].includes(body.metric)) throw new Error('Invalid metric');
  if (!['alert_only','block'].includes(body.action)) throw new Error('Invalid action');
  if (typeof body.enabled !== 'boolean') throw new Error('enabled must be boolean');
  for (const [key,max] of [['threshold',100000],['window_seconds',3600],['block_seconds',86400]]) {
    if (!Number.isInteger(body[key]) || body[key]<1 || body[key]>max) throw new Error(`${key} must be 1–${max}`);
  }
  return [text(body.name,'name'),body.enabled,body.metric,body.threshold,body.window_seconds,body.block_seconds,body.action,body.customer_id == null ? null : id(body.customer_id)];
}
defense.get('/behavior-rules', async (req,res) => res.json((await db.query('SELECT * FROM behavior_rules ORDER BY id')).rows));
defense.post('/behavior-rules', async (req,res) => {
  const result=await db.query('INSERT INTO behavior_rules(name,enabled,metric,threshold,window_seconds,block_seconds,action,customer_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',behavior(req.body));
  await queueRuntime('all'); res.status(201).json(result.rows[0]);
});
defense.put('/behavior-rules/:id', async (req,res) => {
  const result=await db.query('UPDATE behavior_rules SET name=$1,enabled=$2,metric=$3,threshold=$4,window_seconds=$5,block_seconds=$6,action=$7,customer_id=$8,revision=revision+1 WHERE id=$9 RETURNING *',[...behavior(req.body),id(req.params.id)]);
  if (!result.rowCount) return res.status(404).json({error:'Rule not found'});
  await queueRuntime('all'); res.json(result.rows[0]);
});
defense.delete('/behavior-rules/:id', async (req,res) => {
  const result=await db.query('DELETE FROM behavior_rules WHERE id=$1',[id(req.params.id)]);
  if (result.rowCount) await queueRuntime('all'); res.status(result.rowCount?204:404).send();
});
defense.get('/auto-defense/events', async (req,res) => res.json((await db.query("SELECT * FROM sip_events WHERE behavior_rule_id IS NOT NULL OR reason='temporary_behavior_ban' ORDER BY created_at DESC,id DESC LIMIT 100")).rows));
