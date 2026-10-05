import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
process.env.ADMIN_PASSWORD='test-password-strong-enough';
process.env.SESSION_SECRET='test-signing-secret-strong-enough-for-session';
const {auth,requireAuth}=await import('../src/auth.js');
test('authentication requires valid signed cookies and rejects cross-origin writes', async()=>{
  const app=express();app.use(express.json());app.use('/api/auth',auth);app.use('/api',requireAuth);app.all('/api/private',(req,res)=>res.json({ok:true}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(base+'/api/private')).status,401);
    const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:process.env.ADMIN_PASSWORD})});
    assert.equal(login.status,200);const header=login.headers.get('set-cookie');assert.match(header,/HttpOnly/);assert.match(header,/SameSite=Strict/);const cookie=header.split(';')[0];
    assert.equal((await fetch(base+'/api/private',{headers:{Cookie:cookie}})).status,200);
    assert.equal((await fetch(base+'/api/private',{headers:{Cookie:cookie+'forged'}})).status,401);
    assert.equal((await fetch(base+'/api/private',{method:'POST',headers:{Cookie:cookie,Origin:'https://attacker.example'}})).status,403);
    const logout=await fetch(base+'/api/auth/logout',{method:'POST',headers:{Cookie:cookie}});assert.match(logout.headers.get('set-cookie'),/Max-Age=0/);
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
