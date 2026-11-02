const { test, expect } = require('@playwright/test');

test.describe('Authentication Pages & Form Interactivity', () => {
  test('renders customer login page with role switch and input fields', async ({ page }) => {
    await page.goto('/ar/login');

    // Page heading or branding
    await expect(page).toHaveURL(/\/login/);

    // Verify identifier (email/phone) and password fields
    const identifierInput = page.locator('input[placeholder*="بياناتك"], input[placeholder*="details"], input[type="text"]').first();
    await expect(identifierInput).toBeVisible();

    const passwordInput = page.locator('input[placeholder*="••••"], input[type="password"]').first();
    await expect(passwordInput).toBeVisible();

    // Fill in inputs
    await identifierInput.fill('01012345678');
    await passwordInput.fill('TestSecret123!');
    await expect(identifierInput).toHaveValue('01012345678');

    // Toggle password visibility
    const eyeBtn = page.locator('button[aria-label*="كلمة المرور"], button[aria-label*="password"]').first();
    if (await eyeBtn.isVisible()) {
      await eyeBtn.click();
      await expect(passwordInput).toHaveAttribute('type', 'text');
      await eyeBtn.click();
      await expect(passwordInput).toHaveAttribute('type', 'password');
    }
  });

  test('allows switching between customer and vendor login tabs', async ({ page }) => {
    await page.goto('/ar/login');

    // Look for customer (مشتري) and vendor (تاجر) tab buttons
    const vendorTab = page.locator('button:has-text("تاجر"), button:has-text("Vendor")').first();
    const customerTab = page.locator('button:has-text("مشتري"), button:has-text("عميل"), button:has-text("Customer")').first();

    await expect(vendorTab).toBeVisible();
    await expect(customerTab).toBeVisible();

    // Click Vendor tab
    await vendorTab.click();
    await page.waitForTimeout(300);

    // Click Customer tab back
    await customerTab.click();
    await page.waitForTimeout(300);
  });

  test('renders customer registration page', async ({ page }) => {
    await page.goto('/ar/register');

    await expect(page).toHaveURL(/\/register/);
    const form = page.locator('form').first();
    await expect(form).toBeVisible();
  });

  test('renders admin login page and validates invalid credentials', async ({ page }) => {
    await page.goto('/ar/admin/login');

    await expect(page).toHaveURL(/\/admin\/login/);

    // Locate username and password inputs
    const usernameInput = page.locator('input[type="text"]').first();
    const passwordInput = page.locator('input[type="password"]').first();
    const submitBtn = page.locator('button[type="submit"]').first();

    await expect(usernameInput).toBeVisible();
    await expect(passwordInput).toBeVisible();

    // Fill invalid credentials
    await usernameInput.fill('invalid_admin');
    await passwordInput.fill('wrong_password');
    await submitBtn.click();

    // Expect an error alert or error message to appear
    const errorBox = page.locator('[class*="red"], .text-red-500, .text-red-600').filter({ visible: true }).first();
    await expect(errorBox).toBeVisible({ timeout: 5000 });
  });
});
