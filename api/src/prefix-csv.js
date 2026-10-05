import {parse} from 'csv-parse/sync';

export function readPrefixCsv(csv) {
  if(typeof csv!=='string'||!csv.trim())throw new Error('Upload a UTF-8 CSV file with a prefix header');
  let records;
  try {records=parse(csv,{bom:true,trim:true,skip_empty_lines:true,max_record_size:2048,to:1002});}
  catch(error){throw new Error(`Invalid CSV: ${error.message}`);}
  const headers=(records.shift()??[]).map(value=>value.toLowerCase());
  if(!headers.includes('prefix')||new Set(headers).size!==headers.length||headers.some(value=>!['prefix','reason'].includes(value)))throw new Error('CSV headers must be prefix and optionally reason');
  if(!records.length||records.length>1000)throw new Error('CSV must contain between 1 and 1,000 data records');
  const unique=new Map();
  for(const [index,record] of records.entries()) {
    const prefix=record[headers.indexOf('prefix')];
    const reason=headers.includes('reason')?record[headers.indexOf('reason')]:'';
    if(!/^[+0-9*#]{1,64}$/.test(prefix))throw new Error(`Record ${index+1}: prefix must contain 1–64 digits or +, *, #. Format spreadsheet prefixes as text to preserve leading zeros.`);
    if(reason.length>512||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(reason))throw new Error(`Record ${index+1}: reason must be at most 512 characters without control characters`);
    if(!unique.has(prefix))unique.set(prefix,reason||null);
  }
  return {records:records.length,rows:[...unique].map(([prefix,reason])=>({prefix,reason}))};
}
