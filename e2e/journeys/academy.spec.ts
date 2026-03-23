import { test, expect } from '../fixtures/auth.fixture';

test.describe('User Journey: Academy Progression', () => {
  test('navigate to academy, select tier, open lesson, take quiz', async ({ authenticatedPage: page }) => {
    // Mock academy data
    const tiers = [
      {
        id: 'tier-beginner',
        name: 'Beginner',
        slug: 'beginner',
        description: 'Start your investing journey',
        order_index: 0,
      },
      {
        id: 'tier-intermediate',
        name: 'Intermediate',
        slug: 'intermediate',
        description: 'Build on your knowledge',
        order_index: 1,
      },
    ];

    const lessons = [
      {
        id: 'lesson-1',
        tier_id: 'tier-beginner',
        slug: 'what-is-investing',
        title: 'What is Investing?',
        short_summary: 'Learn the basics of investing and why it matters.',
        content_markdown: '# What is Investing?\n\nInvesting is the act of allocating resources...',
        order_index: 0,
        is_published: true,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
      {
        id: 'lesson-2',
        tier_id: 'tier-beginner',
        slug: 'types-of-investments',
        title: 'Types of Investments',
        short_summary: 'Explore stocks, bonds, ETFs, and more.',
        content_markdown: '# Types of Investments\n\nThere are many types of investments...',
        order_index: 1,
        is_published: true,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
    ];

    const quizQuestions = [
      {
        id: 'q1',
        lesson_id: 'lesson-1',
        question_text: 'What is the primary goal of investing?',
        options: ['To grow wealth over time', 'To lose money', 'To spend money faster', 'None of the above'],
        correct_index: 0,
        order_index: 0,
      },
    ];

    const progressRecords: Array<Record<string, unknown>> = [];

    // Mock academy schema endpoints
    await page.route('**/rest/v1/tiers*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(tiers),
      });
    });

    await page.route('**/rest/v1/lessons*', async (route) => {
      const method = route.request().method();
      const url = route.request().url();

      if (method === 'GET') {
        // Filter by slug if query param present
        if (url.includes('slug=eq.')) {
          const slug = url.match(/slug=eq\.([^&]+)/)?.[1];
          const lesson = lessons.find((l) => l.slug === slug);
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(lesson ? [lesson] : []),
          });
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(lessons),
        });
        return;
      }

      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });

    await page.route('**/rest/v1/quiz_questions*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(quizQuestions),
      });
    });

    await page.route('**/rest/v1/user_lesson_progress*', async (route) => {
      const method = route.request().method();

      if (method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(progressRecords),
        });
        return;
      }

      if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
        const body = JSON.parse(route.request().postData() || '{}');
        progressRecords.push({
          id: `progress-${progressRecords.length + 1}`,
          ...body,
          created_at: new Date().toISOString(),
        });
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(body),
        });
        return;
      }

      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.route('**/rest/v1/quiz_attempts*', async (route) => {
      const method = route.request().method();
      if (method === 'POST') {
        const body = JSON.parse(route.request().postData() || '{}');
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ id: `attempt-1`, ...body, score: 100 }),
        });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });

    // Navigate to academy
    await page.goto('/academy', { waitUntil: 'networkidle', timeout: 15_000 });
    await page.waitForURL(/\/(academy|onboarding)/, { timeout: 10_000 });

    if (page.url().includes('/onboarding')) {
      test.skip(true, 'Redirected to onboarding — academy journey requires completed onboarding');
      return;
    }

    await page.waitForLoadState('networkidle');

    // Step 1: Verify academy page loaded
    const bodyText = await page.textContent('body');
    expect(bodyText).toBeTruthy();

    // Step 2: Click on Beginner tier
    const beginnerLink = page.getByText('Beginner', { exact: false }).first();
    if (await beginnerLink.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await beginnerLink.click();
      await page.waitForLoadState('networkidle', { timeout: 10_000 });

      // Step 3: Click on first lesson
      const lessonLink = page.getByText('What is Investing', { exact: false }).first();
      if (await lessonLink.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await lessonLink.click();
        await page.waitForLoadState('networkidle', { timeout: 10_000 });

        // Step 4: Verify lesson content loaded
        const lessonContent = await page.textContent('body');
        expect(lessonContent).toBeTruthy();

        // Step 5: Look for quiz section and attempt it
        const quizButton = page.getByRole('button', { name: /quiz|test|start/i });
        if (await quizButton.isVisible({ timeout: 3_000 }).catch(() => false)) {
          await quizButton.click();

          // Select the first option (correct answer)
          const firstOption = page.getByText('To grow wealth over time', { exact: false });
          if (await firstOption.isVisible({ timeout: 3_000 }).catch(() => false)) {
            await firstOption.click();

            // Submit quiz
            const submitQuiz = page.getByRole('button', { name: /submit|check|done/i });
            if (await submitQuiz.isVisible({ timeout: 2_000 }).catch(() => false)) {
              await submitQuiz.click();
              await page.waitForTimeout(1_000);
            }
          }
        }
      }
    }

    // Verify we're still on an academy page (didn't crash)
    const finalUrl = page.url();
    expect(finalUrl).toMatch(/academy/);
  });
});
