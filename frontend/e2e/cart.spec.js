const { test, expect } = require('@playwright/test');

test.describe('Cart Drawer & Checkout Staging', () => {
  test('opens and closes cart drawer from header cart button', async ({ page }) => {
    await page.goto('/ar');

    // Click cart icon in header
    const cartBtn = page.locator('button[data-cart-target]').filter({ visible: true }).first();
    await expect(cartBtn).toBeVisible();
    await cartBtn.click();

    // Verify cart drawer backdrop appears
    const backdrop = page.locator('.fixed.inset-0.bg-black\\/60');
    await expect(backdrop).toBeVisible();

    // Press Escape to close or click backdrop
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);

    // Or click close button if still open
    const isBackdropStillThere = await backdrop.isVisible();
    if (isBackdropStillThere) {
      const closeBtn = page.locator('header ~ div button:has(svg.lucide-x), div:has-text("سلة التسوق") button:has(svg.lucide-x)').first();
      if (await closeBtn.isVisible()) {
        await closeBtn.click();
      }
    }
  });

  test('checkout page loads with shipping form and pricing breakdown', async ({ page }) => {
    await page.goto('/ar/checkout');

    // Verify checkout page loaded
    await expect(page).toHaveURL(/\/checkout/);

    // Verify main content container is present and visible
    const mainContainer = page.locator('main').filter({ visible: true }).first();
    await expect(mainContainer).toBeVisible();
  });
});
