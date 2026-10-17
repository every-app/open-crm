import { safeHttpUrl } from "@/shared/safe-url";

export function formatUrlForDisplay(value: string): string {
  try {
    const url = new URL(value);
    const hash = url.hash.startsWith("#:~:") ? "" : url.hash;
    const cleaned = `${url.protocol}//${url.host}${url.pathname}${url.search}${hash}`;
    try {
      return decodeURI(cleaned);
    } catch {
      return cleaned;
    }
  } catch {
    return value;
  }
}

export function resolveUrlHref(
  value: string | null | undefined,
  baseDomain?: string,
): string | null {
  if (!value) return null;
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value)) {
    return safeHttpUrl(value);
  }
  if (!baseDomain) return null;
  return safeHttpUrl(
    `https://${baseDomain}${value.startsWith("/") ? value : `/${value}`}`,
  );
}
