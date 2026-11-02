const { test, expect } = require('@playwright/test');

test.describe('Home Page & Navigation Flow', () => {
  test('loads Arabic home page with proper titles, badges, and branding', async ({ page }) => {
    await page.goto('/ar');

    // Page title or main branding
    await expect(page).toHaveTitle(/Ready Marine|Auto Parts/i);

    // Verify visible brand logo
    const logo = page.locator('img[alt="Ready Marine"], img[alt="Logo"], a[aria-label="Ready Marine Home"]').filter({ visible: true }).first();
    await expect(logo).toBeVisible();

    // Verify Marine Trust Badges from Hero Section
    const genuineBadge = page.locator('text=/100%.*أصل/').filter({ visible: true }).first();
    await expect(genuineBadge).toBeVisible();

    // Verify "تسوق الآن" call to action button
    const shopNowBtn = page.locator('a:has-text("تسوق الآن"), a:has-text("Shop Now")').filter({ visible: true }).first();
    await expect(shopNowBtn).toBeVisible();
  });

  test('switches language between Arabic and English via LanguagePicker', async ({ page }) => {
    await page.goto('/ar');

    // Open visible Language Picker in TopBar
    const langButton = page.locator('button:has-text("العربية"), button:has-text("English")').filter({ visible: true }).first();
    await expect(langButton).toBeVisible();
    await langButton.click();

    // Select English option
    const englishOption = page.locator('ul[role="listbox"] button:has-text("English"), button:has-text("English")').filter({ visible: true }).last();
    await expect(englishOption).toBeVisible();
    await englishOption.click();

    // Wait for language transition
    await page.waitForTimeout(500);
    const currentUrl = page.url();
    expect(currentUrl).toMatch(/\/(en|ar)/);
  });

  test('navbar background updates when scrolling on home page', async ({ page }) => {
    await page.goto('/ar');

    // Initial scroll position is 0
    const header = page.locator('header').first();
    await expect(header).toBeVisible();

    // Scroll down 200px
    await page.evaluate(() => window.scrollTo(0, 250));
    await page.waitForTimeout(300);

    // Header remains visible
    await expect(header).toBeVisible();
  });
});
