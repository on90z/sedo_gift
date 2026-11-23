export function sanitizeHttpOrigin(raw?: string | null): string {
  const trimmed = (raw || '').trim();
  if (!trimmed || !/^https?:\/\//i.test(trimmed)) return '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.origin;
  } catch {
    return '';
  }
}

export const API_BASE_URL = sanitizeHttpOrigin(import.meta.env?.VITE_API_BASE_URL);

export function apiUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return API_BASE_URL ? `${API_BASE_URL}${normalized}` : normalized;
}

export function resolveMediaUrl(url?: string): string {
  if (!url) return '';
  if (url.startsWith('/uploads/') && API_BASE_URL) {
    return `${API_BASE_URL}${url}`;
  }
  return url;
}
