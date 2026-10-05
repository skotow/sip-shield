import { Router } from 'express';
import { db } from '../db.js';
import { searchQuery, toCsv } from '../sip-search.js';
export const sipSearch=Router();
sipSearch.get('/sip-events/search',async(req,res)=>{
  const filter=searchQuery(req.query);
  const client=await db.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout = '5s'");
    const rows=await client.query(`SELECT * FROM sip_events WHERE ${filter.where} ORDER BY created_at DESC,id DESC LIMIT $${filter.values.length+1} OFFSET $${filter.values.length+2}`,[...filter.values,filter.limit,filter.offset]);
    if(req.query.format==='csv') {
      await client.query('COMMIT');
      res.set({'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="sip-explorer.csv"','Cache-Control':'no-store'}).send(toCsv(rows.rows));
      return;
    }
    const summary=await client.query(`WITH filtered AS MATERIALIZED (
      SELECT action,source_ip,called_number,response_code FROM sip_events WHERE ${filter.where}
    ) SELECT count(*)::int AS total_events,
      count(*) FILTER(WHERE action='allowed')::int AS allowed,
      count(*) FILTER(WHERE action='blocked')::int AS blocked,
      (SELECT source_ip FROM filtered WHERE NULLIF(source_ip,'') IS NOT NULL GROUP BY source_ip ORDER BY count(*) DESC,source_ip LIMIT 1) AS top_source_ip,
      (SELECT called_number FROM filtered WHERE NULLIF(called_number,'') IS NOT NULL GROUP BY called_number ORDER BY count(*) DESC,called_number LIMIT 1) AS top_called_number,
      (SELECT response_code FROM filtered WHERE response_code IS NOT NULL GROUP BY response_code ORDER BY count(*) DESC,response_code LIMIT 1) AS top_response_code
      FROM filtered`,filter.values);
    await client.query('COMMIT');
    res.set('Cache-Control','no-store').json({events:rows.rows,summary:summary.rows[0],limit:filter.limit,offset:filter.offset,date_from:filter.date_from,date_to:filter.date_to});
  } catch(error) {
    await client.query('ROLLBACK');
    if(error.code==='57014') return res.status(503).json({error:'Search timed out. Narrow the date range or add filters.'});
    throw error;
  } finally {client.release();}
});
