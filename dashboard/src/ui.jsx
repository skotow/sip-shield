import React from 'react';
const paths = {
  shield:'M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z M9 12l2 2 4-4',
  Overview:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  Customers:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75',
  Rules:'M4 7h16 M4 17h16 M8 4v6 M16 14v6',
  'Auto Defense':'m13 2-3 8H4l7 12 3-8h6L13 2Z',
  Events:'M3 12h4l3-8 4 16 3-8h4',
  'SIP Explorer':'M21 21l-5-5 M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14',
  Settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2',
  refresh:'M20 7v5h-5 M4 17v-5h5 M6 6a8 8 0 0 1 13 2 M18 18a8 8 0 0 1-13-2',
  check:'m5 12 4 4L19 6',
  logout:'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9',
  arrow:'M7 17 17 7 M7 7h10v10',
};
export function Icon({name,size=20,...props}) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}><path d={paths[name]||paths.shield}/></svg>;
}
export function Badge({value}) {
  const label=typeof value==='boolean'?(value?'Enabled':'Disabled'):String(value).replaceAll('_',' ');
  const tone=[true,'allowed','allow','success'].includes(value)?'positive':['blocked','block','failed'].includes(value)?'negative':['would_block','alert_only','queued','activating'].includes(value)?'warning':'neutral';
  return <span className={`badge ${tone}`}><span className="badge-dot"/>{label}</span>;
}
