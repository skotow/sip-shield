import test from 'node:test';
import assert from 'node:assert/strict';
import { behavior } from '../src/routes/defense.js';
const rule={name:'Test',enabled:true,metric:'register',threshold:30,window_seconds:60,block_seconds:1800,action:'alert_only',customer_id:null};
test('behavior limits reject unsafe counters and invalid policy',()=>{
  assert.deepEqual(behavior(rule),['Test',true,'register',30,60,1800,'alert_only',null]);
  for(const change of [{threshold:0},{threshold:1.5},{window_seconds:3601},{block_seconds:86401},{enabled:'true'},{metric:'arbitrary'},{action:'permanent'},{customer_id:-1}])assert.throws(()=>behavior({...rule,...change}));
});
