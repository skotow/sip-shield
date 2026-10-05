import { isIP } from 'node:net';

export const csvColumns = ['created_at','customer_id','source_ip','source_port','transport','method','call_id','from_user','from_domain','to_user','to_domain','request_uri','called_number','caller_id','user_agent','backend_host','backend_port','response_code','response_reason','action','reason','asn','asn_name','country'];
const exact = ['customer_id','source_ip','called_number','caller_id','backend_host','method','response_code','action','asn','country','call_id'];
function integer(value, name, min, max) {
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value)<min || Number(value)>max) throw new Error(`${name} must be an integer from ${min} to ${max}`);
  return Number(value);
}
export function searchQuery(query, now = new Date()) {
  const values = [], clauses = [];
  const add = (sql, value) => { values.push(value); clauses.push(sql.replace('?',`$${values.length}`)); };
  const date = (value, fallback) => {
    if (value === undefined || value === '') return fallback;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('Dates must be ISO timestamps with a timezone');
    return new Date(value);
  };
  const end = date(query.date_to, now);
  const start = date(query.date_from, new Date(end.getTime()-86400000));
  if (start >= end || end-start > 31*86400000) throw new Error('Search range must be positive and no longer than 31 days');
  add('created_at >= ?::timestamptz',start.toISOString()); add('created_at < ?::timestamptz',end.toISOString());
  for (const column of exact) {
    let value = query[column];
    if (value === undefined || value === '') continue;
    if (typeof value !== 'string' || value.length>512) throw new Error(`Invalid ${column}`);
    value=value.trim();
    if (column === 'customer_id') value=integer(value,column,1,2147483647);
    if (column === 'response_code') value=integer(value,column,100,699);
    if (column === 'asn') value=integer(value,column,1,4294967295);
    if (column === 'source_ip' && !isIP(value)) throw new Error('source_ip must be an exact IP address');
    if (column === 'method') { value=value.toUpperCase(); if (!/^[A-Z][A-Z0-9_.!%*+`'~-]{0,31}$/.test(value)) throw new Error('Invalid method'); }
    if (column === 'country') { value=value.toUpperCase(); if (!/^[A-Z]{2}$/.test(value)) throw new Error('country must be a two-letter code'); }
    if (column === 'action' && !['allowed','blocked','would_block'].includes(value)) throw new Error('Invalid action');
    add(`${column} = ?`,value);
  }
  if (query.user_agent !== undefined && query.user_agent !== '') {
    if (typeof query.user_agent !== 'string' || query.user_agent.length>512) throw new Error('Invalid user_agent');
    add('user_agent ILIKE ?',`%${query.user_agent.replace(/[\\%_]/g,'\\$&')}%`);
  }
  const limit=integer(query.limit ?? '100','limit',1,1000);
  const offset=integer(query.offset ?? '0','offset',0,100000);
  if (query.format !== undefined && !['json','csv'].includes(query.format)) throw new Error('format must be json or csv');
  return {where:clauses.join(' AND '), values, limit, offset, date_from:start.toISOString(),date_to:end.toISOString()};
}
export function toCsv(rows) {
  const cell = value => {
    let text=value instanceof Date ? value.toISOString() : String(value ?? '');
    // Prevent spreadsheet formulas, including leading whitespace/control characters.
    if (/^[\s]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text="'"+text;
    return '"'+text.replaceAll('"','""')+'"';
  };
  return [csvColumns.join(','),...rows.map(row=>csvColumns.map(key=>cell(row[key])).join(','))].join('\r\n')+'\r\n';
}
