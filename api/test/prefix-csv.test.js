import test from 'node:test';
import assert from 'node:assert/strict';
import {readPrefixCsv} from '../src/prefix-csv.js';
test('prefix CSV preserves leading zeros, BOM, quoting and dial symbols',()=>{
  const result=readPrefixCsv('\ufeffprefix,reason\r\n00900,"Premium, rate"\r\n+44,"a ""quoted"" reason"\r\n*123,"multi\nline"\r\n00900,duplicate\r\n');
  assert.equal(result.records,4);assert.deepEqual(result.rows,[{prefix:'00900',reason:'Premium, rate'},{prefix:'+44',reason:'a "quoted" reason'},{prefix:'*123',reason:'multi\nline'}]);
  assert.deepEqual(readPrefixCsv('prefix\n00123\n').rows,[{prefix:'00123',reason:null}]);
});
test('invalid CSV rejects the entire upload',()=>{
  for(const csv of ['','reason\nfoo','prefix,prefix\n1,2','prefix,other\n1,2','prefix\n','prefix\n123\nBAD','prefix,reason\n123,"unclosed','prefix\n'+'1'.repeat(65),'prefix,reason\n1,'+'a'.repeat(513),'prefix,reason\n1,a\x00b','prefix\n'+Array(1001).fill('123').join('\n')])assert.throws(()=>readPrefixCsv(csv));
});
