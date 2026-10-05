import test from 'node:test';
import assert from 'node:assert/strict';
import {searchQuery,toCsv} from '../src/sip-search.js';
test('bounded parameterized search and literal User-Agent matching',()=>{
  const query=searchQuery({called_number:"123' OR true --",user_agent:'x%_\\',source_ip:'2001:db8::1',method:'invite',asn:'4294967295'});
  assert.ok(!query.where.includes('OR true'));assert.ok(query.values.includes("123' OR true --"));
  assert.ok(query.values.includes('%x\\%\\_\\\\%'));assert.ok(query.values.includes('INVITE'));
  assert.equal(query.limit,100);assert.equal(query.offset,0);
});
test('reject unsafe pagination, invalid filters and unbounded dates',()=>{
  for(const query of [{limit:'1001'},{offset:'-1'},{customer_id:'1.1'},{source_ip:'192.0.2.0/24'},{action:'oops'},{response_code:'99'},{country:'USA'},{asn:'4294967296'},{method:['INVITE']},{date_from:'2026-01-01T00:00:00Z',date_to:'2026-03-01T00:00:00Z'},{date_from:'2026-01-01'}])assert.throws(()=>searchQuery(query));
});
test('CSV escapes quotes/newlines and neutralizes spreadsheet formulas',()=>{
  const csv=toCsv([{called_number:'+12025550100',caller_id:' =1+2',user_agent:'agent,"quoted"\nnext'}]);
  assert.ok(csv.includes('"\'+12025550100"'));assert.ok(csv.includes('"\' =1+2"'));assert.ok(csv.includes('"agent,""quoted""\nnext"'));
});
