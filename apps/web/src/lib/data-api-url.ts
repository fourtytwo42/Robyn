export function resolveDataApiUrl(configured: string | undefined) {
  const value = configured?.trim();
  return value ? value.replace(/\/+$/, "") : "/api";
}
