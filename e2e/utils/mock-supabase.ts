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

export async function installSupabaseMocks(page: Page) {
  await page.route('**/auth/v1/token?grant_type=password', async (route) => {
    await fulfillJson(route, mockSession);
  });

  await page.route('**/auth/v1/token?grant_type=refresh_token', async (route) => {
    await fulfillJson(route, mockSession);
  });

  await page.route('**/auth/v1/user', async (route) => {
    await fulfillJson(route, { ...mockSession.user });
  });

  await page.route('**/auth/v1/logout', async (route) => {
    await fulfillJson(route, {});
  });

  await page.route('**/rest/v1/users*', async (route) => {
    await fulfillJson(route, profile);
  });

  await page.route('**/rest/v1/**', async (route) => {
    const method = route.request().method();

    if (method === 'GET') {
      await fulfillJson(route, []);
      return;
    }

    if (method === 'POST') {
      await fulfillJson(route, [{ id: 'mock-row-id' }], 201);
      return;
    }

    await fulfillJson(route, {});
  });
}
