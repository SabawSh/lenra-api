/**
 * Route params use plain strings; content tables use UUID strings.
 */
const UUID_PARAM_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isContentIdParam(value: string | undefined | null): boolean {
  if (!value?.trim()) return false;
  return UUID_PARAM_RE.test(value.trim());
}
