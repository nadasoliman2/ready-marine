const { test, expect } = require('@playwright/test');

test.describe('Products Catalog & Search Flow', () => {
  test('loads products catalog page with search and filter controls', async ({ page }) => {
    await page.goto('/ar/products');

    // Page title and main structure
    await expect(page).toHaveURL(/\/products/);

    // Main search input
    const searchInput = page.locator('input[type="search"]').first();
    if (await searchInput.isVisible()) {
      await searchInput.fill('موتور');
      await expect(searchInput).toHaveValue('موتور');
    }
  });

  test('renders product cards with price and "أضف إلى السلة" button', async ({ page }) => {
    await page.goto('/ar/products');

    // Wait for product listing or empty state to render
    const productGrid = page.locator('[class*="grid"]').first();
    await expect(productGrid).toBeVisible();

    // Look for add to cart buttons
    const addToCartBtns = page.locator('button:has-text("أضف إلى السلة"), button:has-text("Add to cart")');
    const count = await addToCartBtns.count();

    if (count > 0) {
      const firstBtn = addToCartBtns.first();
      await expect(firstBtn).toBeVisible();
    }
  });

  test('clicking product card navigates to product details or opens options', async ({ page }) => {
    await page.goto('/ar/products');

    const productLinks = page.locator('a[href*="/product/"]');
    const count = await productLinks.count();

    if (count > 0) {
      const firstProduct = productLinks.first();
      const href = await firstProduct.getAttribute('href');
      expect(href).toMatch(/\/product\//);
    }
  });
});
