import { Router } from 'express';
import { db } from '../db.js';
import { queueRuntime } from '../services/runtime.js';
export const config = Router();
config.post('/apply-config', async (req,res)=>res.status(202).json(await queueRuntime('all')));
config.post('/reload-permissions', async (req,res)=>res.status(202).json(await queueRuntime('permissions')));
config.get('/reload-status', async (req,res)=>res.json((await db.query(req.query.id ? 'SELECT * FROM runtime_requests WHERE id=$1' : 'SELECT * FROM runtime_requests ORDER BY requested_at DESC LIMIT 1',req.query.id ? [req.query.id] : [])).rows[0] || {status:'idle',message:'No runtime update requested'}));
