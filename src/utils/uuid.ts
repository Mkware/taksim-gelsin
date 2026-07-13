/** UUID v4 (Supabase varsayılanı) — route/param doğrulaması */
const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Herhangi bir RFC 4122 UUID (seed / eski kayıtlar dahil) */
const UUID_ANY_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUUIDv4(v: unknown): v is string {
  return typeof v === 'string' && UUID_V4_RE.test(v);
}

export function isValidUUID(v: unknown): v is string {
  return typeof v === 'string' && UUID_ANY_RE.test(v.trim());
}
