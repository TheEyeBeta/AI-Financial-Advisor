import type { Page, Route } from '@playwright/test';
import { testUser } from '../fixtures/test-user';

const mockSession = {
  access_token: 'mock-access-token',
  refresh_token: 'mock-refresh-token',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  token_type: 'bearer',
  user: {
    id: testUser.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: testUser.email,
    email_confirmed_at: '2024-01-01T00:00:00.000Z',
    phone: '',
    confirmed_at: '2024-01-01T00:00:00.000Z',
    last_sign_in_at: new Date().toISOString(),
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: { full_name: testUser.name },
    identities: [],
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: new Date().toISOString(),
    is_anonymous: false,
  },
};

const profile = {
  id: testUser.profileId,
  auth_id: testUser.id,
  email: testUser.email,
  first_name: 'Test',
  last_name: 'User',
  userType: 'User',
  onboarding_complete: true,
  experience_level: 'beginner',
  created_at: '2024-01-01T00:00:00.000Z',
  updated_at: '2024-01-01T00:00:00.000Z',
};

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

export async function installSupabaseMocks(page: Page, options?: { onboardingComplete?: boolean }) {
  const onboardingComplete = options?.onboardingComplete ?? true;
  const profileWithOnboarding = {
    ...profile,
    onboarding_complete: onboardingComplete,
  };

  // Track authentication state
  let isAuthenticated = false;

  // Handle Google OAuth authorize redirect (mock — no real Google page)
  await page.route('**/auth/v1/authorize**', async (route) => {
    isAuthenticated = true;
    const url = new URL(route.request().url());
    const redirectTo = url.searchParams.get('redirect_to') || '/auth/callback';
    await route.fulfill({
      status: 302,
      headers: {
        Location: `${redirectTo}${redirectTo.includes('?') ? '&' : '?'}code=mock-oauth-code`,
      },
    });
  });

  // Handle token grants (password sign-in, refresh)
  await page.route(/\/auth\/v1\/token/, async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }

    const url = new URL(route.request().url());
    const rawBody = route.request().postData() ?? '';
    let grantType = url.searchParams.get('grant_type') ?? undefined;

    try {
      const json = JSON.parse(rawBody) as { grant_type?: string; email?: string; password?: string };
      grantType = grantType ?? json.grant_type ?? (json.email && json.password ? 'password' : undefined);
    } catch {
      const params = new URLSearchParams(rawBody);
      grantType = grantType ?? params.get('grant_type') ?? undefined;
      if (!grantType && params.get('email') && params.get('password')) {
        grantType = 'password';
      }
    }

    if (!grantType || grantType === 'password') {
      isAuthenticated = true;
      await fulfillJson(route, mockSession);
      return;
    }

    if (grantType === 'refresh_token') {
      if (isAuthenticated) {
        await fulfillJson(route, mockSession);
      } else {
        await fulfillJson(route, { error: 'invalid_grant' }, 400);
      }
      return;
    }

    isAuthenticated = true;
    await fulfillJson(route, mockSession);
  });

  // Handle getSession - return session only if authenticated
  await page.route('**/auth/v1/user', async (route) => {
    if (isAuthenticated) {
      await fulfillJson(route, { ...mockSession.user });
    } else {
      await fulfillJson(route, { error: 'not_authenticated' }, 401);
    }
  });

  // Mock the session endpoint used by getSession()
  await page.route('**/auth/v1/session', async (route) => {
    if (isAuthenticated) {
      await fulfillJson(route, { data: { session: mockSession }, error: null });
    } else {
      await fulfillJson(route, { data: { session: null }, error: null });
    }
  });

  await page.route('**/auth/v1/logout', async (route) => {
    isAuthenticated = false;
    await fulfillJson(route, {});
  });

  // Register the catch-all first so specific REST handlers below take priority.
  await page.route('**/rest/v1/**', async (route) => {
    const method = route.request().method();
    const url = route.request().url();
    const prefer = route.request().headers()['prefer'] ?? '';

    if (method === 'HEAD' || prefer.includes('count=exact')) {
      await route.fulfill({
        status: 200,
        headers: {
          'content-type': 'application/json',
          'content-range': '*/0',
        },
        body: '',
      });
      return;
    }

    if (method === 'GET') {
      if (url.includes('chats') || url.includes('chat_messages')) {
        await fulfillJson(route, []);
        return;
      }
      await fulfillJson(route, []);
      return;
    }

    if (method === 'POST') {
      const resourceType = url.includes('chats') ? 'chats' :
                          url.includes('chat_messages') ? 'chat_messages' : 'resource';
      await fulfillJson(route, [{ id: `mock-${resourceType}-${Date.now()}` }], 201);
      return;
    }

    if (method === 'PATCH' || method === 'PUT') {
      await fulfillJson(route, {});
      return;
    }

    if (method === 'DELETE') {
      await fulfillJson(route, {});
      return;
    }

    await fulfillJson(route, {});
  });

  await page.route('**/rest/v1/users*', async (route) => {
    if (isAuthenticated) {
      const _url = route.request().url();
      const method = route.request().method();
      
      // Supabase REST API behavior:
      // - Queries with filters return arrays: [profile]
      // - .single() in the client extracts the first element
      // - But the REST API always returns arrays for GET requests
      // - POST/PATCH return the object directly
      
      if (method === 'GET' || method === 'HEAD') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: method === 'HEAD' ? { 'content-range': '0-0/1' } : undefined,
          body: method === 'HEAD' ? '' : JSON.stringify([profileWithOnboarding]),
        });
        return;
      }

      if (method === 'POST') {
        await fulfillJson(route, profileWithOnboarding, 201);
        return;
      }

      if (method === 'PATCH' || method === 'PUT') {
        await fulfillJson(route, profileWithOnboarding);
        return;
      }

      await fulfillJson(route, profileWithOnboarding);
    } else {
      await fulfillJson(route, [], 401);
    }
  });

  // Chat list RPC (ai.get_chat_page). Without this, the generic POST handler
  // above answers with a placeholder row whose shape breaks the chat list.
  await page.route('**/rest/v1/rpc/get_chat_page*', async (route) => {
    await fulfillJson(route, []);
  });

  await page.route('**/rest/v1/user_profiles*', async (route) => {
    const method = route.request().method();
    const prefer = route.request().headers()['prefer'] ?? '';

    if (method === 'HEAD' || prefer.includes('count=exact')) {
      await route.fulfill({
        status: 200,
        headers: {
          'content-type': 'application/json',
          'content-range': '*/0',
        },
        body: '',
      });
      return;
    }

    if (method === 'GET') {
      await fulfillJson(route, []);
      return;
    }

    if (method === 'POST') {
      await fulfillJson(route, [{}], 201);
      return;
    }

    await fulfillJson(route, {});
  });
}
