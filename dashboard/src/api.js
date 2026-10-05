export async function api(path, method = 'GET', body) {
  const response = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (response.status === 204) return null;
  const result = await response.json().catch(() => ({}));
  if(response.status===401 && !path.startsWith('/api/auth'))window.dispatchEvent(new Event('sipshield-unauthorized'));
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
  return result;
}
