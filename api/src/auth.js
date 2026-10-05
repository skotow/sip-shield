import { Router } from 'express';
import { scryptSync, timingSafeEqual, createHmac, randomBytes } from 'node:crypto';
export const auth = Router();
const password = process.env.ADMIN_PASSWORD;
const secret = process.env.SESSION_SECRET;
if (!password || password.length < 16 || !secret || secret.length < 32) throw new Error('Set ADMIN_PASSWORD (16+ characters) and SESSION_SECRET (32+ characters)');
const salt = randomBytes(16);
const hash = scryptSync(password, salt, 32);
const username = process.env.ADMIN_USER || 'admin';
const sign = data => createHmac('sha256',secret).update(data).digest('base64url');
const secure = process.env.COOKIE_SECURE === 'true' ? '; Secure' : '';
const cookie = (value, age) => `sipshield=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${secure}`;
const attempts = new Map();
export function authenticated(req) {
  const token = (req.headers.cookie || '').split(';').map(s=>s.trim()).find(s=>s.startsWith('sipshield='))?.slice(10);
  if (!token) return false;
  const [data,signature] = token.split('.');
  const expected = sign(data || '');
  if (!signature || signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature),Buffer.from(expected))) return false;
  try { const session = JSON.parse(Buffer.from(data,'base64url').toString()); return session.user === username && session.expires > Date.now(); } catch { return false; }
}
auth.post('/login', (req,res) => {
  const now = Date.now();
  // Bounded local limiter remains available during Redis downtime.
  for (const [key,value] of attempts) if (value.until < now) attempts.delete(key);
  const key = req.ip;
  const limit = attempts.get(key) || { count:0,until:now+60000 };
  if (limit.count >= 5) return res.status(429).json({error:'Too many login attempts; retry in one minute'});
  limit.count++; attempts.set(key,limit);
  const input = typeof req.body.password === 'string' ? req.body.password.slice(0,1024) : '';
  if (req.body.username !== username || !timingSafeEqual(scryptSync(input,salt,32),hash)) return res.status(401).json({error:'Invalid username or password'});
  attempts.delete(key);
  const data = Buffer.from(JSON.stringify({user:username,expires:now+8*3600000})).toString('base64url');
  res.setHeader('Set-Cookie',cookie(`${data}.${sign(data)}`,8*3600)); res.json({user:username});
});
auth.post('/logout',(req,res)=>{res.setHeader('Set-Cookie',cookie('',0));res.json({ok:true});});
auth.get('/session',(req,res)=>res.status(authenticated(req)?200:401).json({authenticated:authenticated(req)}));
export function requireAuth(req,res,next) {
  if (!authenticated(req)) return res.status(401).json({error:'Authentication required'});
  // SameSite cookies plus explicit same-origin checks protect browser writes.
  if (!['GET','HEAD'].includes(req.method) && req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return res.status(403).json({error:'Cross-origin writes forbidden'});
  next();
}
