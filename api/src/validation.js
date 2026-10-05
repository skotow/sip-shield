export function customer(body) {
  for (const key of ['name', 'domain', 'backend_host']) {
    if (typeof body[key] !== 'string' || !body[key].trim() || body[key].length > 255) throw new Error(`${key} is required (max 255 characters)`);
  }
  const port = body.backend_port ?? 5060;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('backend_port must be 1–65535');
  if (body.enabled !== undefined && typeof body.enabled !== 'boolean') throw new Error('enabled must be boolean');
  return [body.name.trim(), body.domain.trim(), body.backend_host.trim(), port, body.enabled ?? true];
}
export function id(value) {
  if (!/^\d+$/.test(String(value)) || Number(value) < 1 || !Number.isSafeInteger(Number(value))) throw new Error('Invalid ID');
  return Number(value);
}
export function text(value, name) {
  if (typeof value !== 'string' || !value.trim() || value.length > 512) throw new Error(`${name} is required (max 512 characters)`);
  return value.trim();
}
