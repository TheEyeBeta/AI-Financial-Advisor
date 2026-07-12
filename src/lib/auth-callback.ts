export const AUTH_CALLBACK_PARAMS_TO_STRIP = [
  'code',
  'access_token',
  'refresh_token',
  'error',
  'error_description',
  'error_code',
  'type',
] as const;

export function stripAuthParamsFromUrl() {
  const url = new URL(window.location.href);
  let changed = false;

  AUTH_CALLBACK_PARAMS_TO_STRIP.forEach((key) => {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      changed = true;
    }
  });

  if (url.hash) {
    const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''));
    AUTH_CALLBACK_PARAMS_TO_STRIP.forEach((key) => hashParams.delete(key));
    const newHash = hashParams.toString();
    if (newHash !== url.hash.replace(/^#/, '')) {
      url.hash = newHash ? `#${newHash}` : '';
      changed = true;
    }
  }

  if (changed) {
    window.history.replaceState({}, document.title, url.pathname + url.search + url.hash);
  }
}

export function hasAuthCallbackParams(searchParams: URLSearchParams): boolean {
  return (
    window.location.hash.includes('access_token') ||
    window.location.hash.includes('code') ||
    searchParams.has('code') ||
    searchParams.has('access_token') ||
    searchParams.has('verified')
  );
}

export function getOAuthErrorMessage(
  error: string | null,
  errorDescription: string | null,
): string | null {
  if (!error) return null;

  if (error === 'access_denied') {
    return 'Google sign-in was cancelled. You can try again when ready.';
  }

  return errorDescription || 'Authentication was not completed. Please try again.';
}
