import { expect, test } from '@playwright/test';
import { signInWithMockedUser } from '../utils/sign-in';

test.describe('User Journey: Onboarding Flow', () => {
  test('incomplete profile is redirected to onboarding after sign-in', async ({ page }) => {
    await signInWithMockedUser(page, { onboardingComplete: false });
    await expect(page).toHaveURL(/\/onboarding/);
  });
});
