const DEFAULT_RETURN_PATH = '/advisor';

/**
 * Sanitize a post-auth return path. Accepts relative paths starting with exactly
 * one `/`. Rejects protocol-relative, absolute, and dangerous values.
 */
export function sanitizeReturnPath(path?: string | null): string {
  if (!path || typeof path !== 'string') {
    return DEFAULT_RETURN_PATH;
  }

  const trimmed = path.trim();
  if (!trimmed) {
    return DEFAULT_RETURN_PATH;
  }

  // Reject protocol-relative, absolute URLs, and dangerous schemes
  if (
    trimmed.startsWith('//') ||
    /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ||
    /javascript:/i.test(trimmed) ||
    /data:/i.test(trimmed)
  ) {
    return DEFAULT_RETURN_PATH;
  }

  // Must start with exactly one leading slash
  if (!trimmed.startsWith('/')) {
    return DEFAULT_RETURN_PATH;
  }

  // Reject backslashes (path traversal / odd encodings)
  if (trimmed.includes('\\')) {
    return DEFAULT_RETURN_PATH;
  }

  return trimmed;
}

export function buildAuthCallbackUrl(returnTo?: string): string {
  const safePath = sanitizeReturnPath(returnTo);
  const params = new URLSearchParams({ next: safePath });
  return `${window.location.origin}/auth/callback?${params.toString()}`;
}

export interface PostAuthUserContext {
  userType?: string | null;
  onboardingComplete: boolean | null;
}

/** Resolve where to send a user immediately after authentication. */
export function resolvePostAuthPath(
  context: PostAuthUserContext,
  nextPath?: string | null,
): string {
  if (context.userType === 'Admin') {
    return '/admin';
  }

  if (context.onboardingComplete === false) {
    return '/onboarding';
  }

  return sanitizeReturnPath(nextPath);
}
