export function toSafeExternalUrl(input: string | null | undefined): string | null {
  if (!input) return null;

  try {
    const parsed = new URL(input);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}
