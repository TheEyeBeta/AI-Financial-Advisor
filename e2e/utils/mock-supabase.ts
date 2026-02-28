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
  // Track authentication state
  let isAuthenticated = false;

  // Handle sign-in - set authenticated state
  await page.route('**/auth/v1/token?grant_type=password', async (route) => {
    isAuthenticated = true;
    await fulfillJson(route, mockSession);
  });

  // Handle refresh token
  await page.route('**/auth/v1/token?grant_type=refresh_token', async (route) => {
    if (isAuthenticated) {
      await fulfillJson(route, mockSession);
    } else {
      await fulfillJson(route, { error: 'invalid_grant' }, 400);
    }
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

  await page.route('**/rest/v1/users*', async (route) => {
    if (isAuthenticated) {
      const _url = route.request().url();
      const method = route.request().method();
      
      // Supabase REST API behavior:
      // - Queries with filters return arrays: [profile]
      // - .single() in the client extracts the first element
      // - But the REST API always returns arrays for GET requests
      // - POST/PATCH return the object directly
      
      if (method === 'GET') {
        // All GET requests return arrays in Supabase REST API
        // The client's .single() will extract the first element
        await fulfillJson(route, [profile]);
        return;
      }
      
      // POST returns the created object
      if (method === 'POST') {
        await fulfillJson(route, profile, 201);
        return;
      }
      
      // PATCH/PUT return the updated object
      if (method === 'PATCH' || method === 'PUT') {
        await fulfillJson(route, profile);
        return;
      }
      
      await fulfillJson(route, profile);
    } else {
      await fulfillJson(route, [], 401);
    }
  });

  await page.route('**/rest/v1/**', async (route) => {
    const method = route.request().method();
    const url = route.request().url();

    // Handle chats and messages - return empty arrays for new users
    if (method === 'GET') {
      if (url.includes('chats') || url.includes('chat_messages')) {
        await fulfillJson(route, []);
        return;
      }
      await fulfillJson(route, []);
      return;
    }

    if (method === 'POST') {
      // Return a mock object with an ID for created resources
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
}
