import { test } from 'node:test';
import assert from 'node:assert/strict';
import { customer, id } from '../src/validation.js';
test('customer defaults and invalid ports', () => {
  const input = { name: ' Demo ', domain: 'demo.local', backend_host: 'pbx' };
  assert.deepEqual(customer(input), ['Demo','demo.local','pbx',5060,true]);
  for (const port of [0,65536,1.5,'5060']) assert.throws(() => customer({ ...input, backend_port: port }));
  assert.throws(() => customer({ ...input, enabled: 'true' }));
});
test('IDs reject malformed input instead of coercing it', () => {
  assert.equal(id('12'),12);
  for (const value of ['1 OR 1=1','0','-1','1.1',null]) assert.throws(() => id(value));
});
