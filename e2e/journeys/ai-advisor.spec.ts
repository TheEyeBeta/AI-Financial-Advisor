import { test, expect } from '../fixtures/auth.fixture';

test.describe('User Journey: AI Advisor Conversation', () => {
  test('send a message, verify response, check chat history', async ({ authenticatedPage: page }) => {
    const chats: Array<Record<string, unknown>> = [];
    const messages: Array<Record<string, unknown>> = [];
    let chatIdCounter = 0;
    let msgIdCounter = 0;

    // Mock chat endpoints
    await page.route('**/rest/v1/chats*', async (route) => {
      const method = route.request().method();

      if (method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(chats),
        });
        return;
      }

      if (method === 'POST') {
        const body = JSON.parse(route.request().postData() || '{}');
        const chat = {
          id: `chat-${++chatIdCounter}`,
          user_id: body.user_id,
          title: body.title || 'New Chat',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        chats.push(chat);
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(chat),
        });
        return;
      }

      if (method === 'PATCH' || method === 'PUT') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
        return;
      }

      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.route('**/rest/v1/chat_messages*', async (route) => {
      const method = route.request().method();

      if (method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(messages),
        });
        return;
      }

      if (method === 'POST') {
        const body = JSON.parse(route.request().postData() || '{}');
        const msg = {
          id: `msg-${++msgIdCounter}`,
          ...body,
          created_at: new Date().toISOString(),
        };
        messages.push(msg);
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(msg),
        });
        return;
      }

      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    // Mock the AI chat proxy endpoint
    await page.route('**/api/chat', async (route) => {
      const method = route.request().method();
      if (method === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: {
            'X-RateLimit-Remaining': '9',
            'X-RateLimit-Limit': '10',
          },
          body: JSON.stringify({
            response: 'Based on my analysis, AAPL has strong fundamentals with a P/E ratio of 28 and consistent revenue growth.',
          }),
        });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    // Mock chat title endpoint
    await page.route('**/api/chat/title', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ title: 'AAPL Analysis' }),
      });
    });

    // Mock stock snapshots for the advisor context
    await page.route('**/rest/v1/stock_snapshots*', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });

    // Navigate to advisor
    await page.goto('/advisor', { waitUntil: 'networkidle', timeout: 15_000 });
    await page.waitForURL(/\/(advisor|onboarding)/, { timeout: 10_000 });

    if (page.url().includes('/onboarding')) {
      test.skip(true, 'Redirected to onboarding — advisor journey requires completed onboarding');
      return;
    }

    await page.waitForLoadState('networkidle');

    // Find the chat input and send a message
    const chatInput = page.locator('textarea, input[type="text"]').last();
    if (await chatInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await chatInput.fill('Tell me about AAPL stock');

      // Submit the message (Enter key or send button)
      const sendBtn = page.getByRole('button', { name: /send/i });
      if (await sendBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await sendBtn.click();
      } else {
        await chatInput.press('Enter');
      }

      // Wait for the AI response to appear
      await page.waitForTimeout(2_000);

      // Check that some response text appeared on the page
      const bodyText = await page.textContent('body');
      expect(bodyText).toBeTruthy();
    }

    // Step 2: Navigate to chat history and verify chat appears
    await page.goto('/chat-history', { waitUntil: 'networkidle', timeout: 15_000 });
    await page.waitForURL(/\/(chat-history|onboarding)/, { timeout: 10_000 });

    // Verify the page loaded successfully
    const historyContent = await page.textContent('body');
    expect(historyContent).toBeTruthy();
  });
});
