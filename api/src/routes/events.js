import { Router } from 'express';
import { db } from '../db.js';
import { id, text } from '../validation.js';
export const events = Router();
events.get('/event-sessions', async (req,res) => {
  const limit=req.query.limit===undefined?100:id(req.query.limit);
  if(limit>1000)throw new Error('limit cannot exceed 1000');
  const result=await db.query(`
    WITH latest AS (
      SELECT * FROM (
        SELECT DISTINCT ON (CASE WHEN NULLIF(call_id,'') IS NULL THEN 'event:'||id ELSE 'call:'||call_id END) *
        FROM sip_events
        ORDER BY CASE WHEN NULLIF(call_id,'') IS NULL THEN 'event:'||id ELSE 'call:'||call_id END,created_at DESC,id DESC
      ) representatives ORDER BY created_at DESC,id DESC LIMIT $1
    )
    SELECT latest.*, summary.first_seen,summary.last_seen,summary.decision_count,summary.methods
    FROM latest CROSS JOIN LATERAL (
      SELECT min(created_at) AS first_seen,max(created_at) AS last_seen,count(*)::int AS decision_count,
        array_agg(DISTINCT method) FILTER(WHERE method IS NOT NULL) AS methods
      FROM sip_events e WHERE e.id=latest.id OR (NULLIF(latest.call_id,'') IS NOT NULL AND e.call_id=latest.call_id)
    ) summary ORDER BY latest.created_at DESC,latest.id DESC
  `,[limit]);
  res.json(result.rows);
});
events.get('/events', async (req, res) => {
  const limit = req.query.limit === undefined ? 100 : id(req.query.limit);
  if (limit > 1000) throw new Error('limit cannot exceed 1000');
  res.json((await db.query('SELECT * FROM sip_events ORDER BY created_at DESC,id DESC LIMIT $1', [limit])).rows);
});
events.get('/events/:id', async (req,res) => {
  const event=(await db.query('SELECT * FROM sip_events WHERE id=$1',[id(req.params.id)])).rows[0];
  if (!event) return res.status(404).json({error:'Event not found'});
  if (!event.call_id) return res.json({event,messages:[],decisions:[event],truncated:false});
  // Bounded result and time range protect management queries on busy gateways.
  const [messages,decisions]=await Promise.all([
    db.query("SELECT * FROM sip_messages WHERE call_id=$1 AND captured_at BETWEEN $2::timestamptz-interval '24 hours' AND $2::timestamptz+interval '24 hours' ORDER BY captured_at,id LIMIT 501",[event.call_id,event.created_at]),
    db.query("SELECT * FROM sip_events WHERE call_id=$1 ORDER BY created_at,id LIMIT 501",[event.call_id]),
  ]);
  res.json({event,messages:messages.rows.slice(0,500),decisions:decisions.rows.slice(0,500),truncated:messages.rows.length>500,decisions_truncated:decisions.rows.length>500});
});
events.post('/events', async (req, res) => {
  if (!['allowed','blocked'].includes(req.body.action)) throw new Error('action must be allowed or blocked');
  const columns = ['customer_id','source_ip','method','from_user','to_user','user_agent','destination','action','reason'];
  const values = columns.map(key => key === 'customer_id' ? (req.body[key] == null ? null : id(req.body[key])) : (req.body[key] == null ? null : text(req.body[key], key)));
  const result = await db.query(`INSERT INTO sip_events(${columns.join(',')}) VALUES(${values.map((_,i)=>`$${i+1}`).join(',')}) RETURNING *`, values);
  res.status(201).json(result.rows[0]);
});
events.get('/stats', async (req, res) => {
  const totals = await db.query("SELECT count(*) FILTER (WHERE action='allowed')::int AS allowed, count(*) FILTER (WHERE action='blocked')::int AS blocked FROM sip_events");
  const sources = await db.query('SELECT source_ip,count(*)::int AS requests FROM sip_events WHERE source_ip IS NOT NULL GROUP BY source_ip ORDER BY requests DESC LIMIT 5');
  res.json({ ...totals.rows[0], top_sources: sources.rows });
});
