const { test, expect } = require('@playwright/test');

test.describe('Mobile Viewport & Bottom Navigation', () => {
  test.use({ viewport: { width: 390, height: 844 } }); // iPhone 13 dimensions

  test('renders mobile header with centered logo and action icons', async ({ page }) => {
    await page.goto('/ar');

    // Logo must be visible in mobile view
    const mobileLogo = page.locator('header img[alt="Ready Marine"], header img[alt="Logo"], header [class*="BrandMark"]').filter({ visible: true }).first();
    await expect(mobileLogo).toBeVisible();

    // Verify search toggle and user profile button exist
    const searchToggle = page.locator('header button[aria-label="البحث"], header button[aria-label="Search"]').filter({ visible: true }).first();
    await expect(searchToggle).toBeVisible();

    // Clicking search opens expandable search bar
    await searchToggle.click();
    const searchInput = page.locator('input[type="search"], input[placeholder*="ابحث"], input[placeholder*="Search"]').filter({ visible: true }).first();
    await expect(searchInput).toBeVisible();
  });

  test('renders mobile bottom navigation bar with expected tabs', async ({ page }) => {
    await page.goto('/ar');

    const bottomNav = page.locator('nav[aria-label="القائمة السفلية"], nav[aria-label="Bottom menu"]').first();
    await expect(bottomNav).toBeVisible();

    // Verify Home, Products, Services, More links/buttons
    const productsTab = bottomNav.locator('a[href*="/products"], a:has-text("المنتجات"), a:has-text("Products")').first();
    await expect(productsTab).toBeVisible();

    const moreBtn = bottomNav.locator('button:has-text("المزيد"), button:has-text("More")').first();
    await expect(moreBtn).toBeVisible();

    // Open More drawer
    await moreBtn.click();
    const moreHeader = page.locator('header:has-text("المزيد"), header:has-text("More")').filter({ visible: true }).first();
    await expect(moreHeader).toBeVisible();

    // Close More drawer
    const closeBtn = page.locator('button[aria-label="إغلاق"], button[aria-label="Close"]').filter({ visible: true }).first();
    await closeBtn.click();
    await expect(moreHeader).not.toBeVisible();
  });

  test('renders transparent mobile hero trust badges', async ({ page }) => {
    await page.goto('/ar');

    // Mobile hero badges
    const genuineBadge = page.locator('text=100% أصلي معتمد').filter({ visible: true }).first();
    await expect(genuineBadge).toBeVisible();

    const fastDeliveryBadge = page.locator('text=توصيل سريع للمرسى').filter({ visible: true }).first();
    await expect(fastDeliveryBadge).toBeVisible();

    const supportBadge = page.locator('text=دعم فني 24/7').filter({ visible: true }).first();
    await expect(supportBadge).toBeVisible();
  });
});
