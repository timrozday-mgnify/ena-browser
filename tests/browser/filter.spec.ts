import { expect, test } from "@playwright/test";
import { columnValues, openDemo, visibleCount } from "./helpers.js";

test("the status toggles hide and restore cancelled/suppressed rows", async ({ page }) => {
  await openDemo(page, { entity: "samples" });
  // Both toggles start checked: 5 fixture samples, one cancelled, one suppressed.
  expect(await visibleCount(page)).toBe(3);

  await page.locator('[data-role="excludeCancelled"]').uncheck();
  expect(await visibleCount(page)).toBe(4);
  expect(await columnValues(page, "status")).toContain("CANCELLED");

  await page.locator('[data-role="excludeSuppressed"]').uncheck();
  expect(await visibleCount(page)).toBe(5);

  await page.locator('[data-role="excludeCancelled"]').check();
  await page.locator('[data-role="excludeSuppressed"]').check();
  expect(await visibleCount(page)).toBe(3);
});

test("the quick filter narrows the grid", async ({ page }) => {
  await openDemo(page, { entity: "samples" });
  await page.locator('[data-role="quick-filter"]').fill("soil");
  await expect.poll(() => visibleCount(page)).toBe(1);
  expect(await columnValues(page, "alias")).toEqual(["mimicc-sample-C"]);

  await page.locator('[data-role="quick-filter"]').fill("");
  await expect.poll(() => visibleCount(page)).toBe(3);
});

test("the per-column dropdown filter narrows the grid", async ({ page }) => {
  await openDemo(page, { entity: "samples" });
  expect(await page.locator("#browser .ht_master tbody tr").count()).toBe(3);

  await page
    .locator("#browser .ht_clone_top th", { hasText: "Title" })
    .locator("button.changeType")
    .click();
  await page.locator(".htUISelectCaption").first().click();
  await page.locator("td[role='menuitem'] .htItemWrapper", { hasText: /^Contains$/ }).click();
  await page.locator(".htFiltersMenuCondition .htUIInput:visible input").first().fill("donor");
  await page.locator(".htUIButton input[value='OK']").click();

  await expect.poll(() => page.locator("#browser .ht_master tbody tr").count()).toBe(2);
});

test("programmatic setFilters matches the toolbar result", async ({ page }) => {
  await openDemo(page, { entity: "samples" });
  await page.evaluate(() => {
    (
      document.getElementById("browser") as unknown as {
        setFilters(specs: unknown[]): void;
      }
    ).setFilters([{ column: "title", operator: "contains", value: "Soil" }]);
  });
  expect(await visibleCount(page)).toBe(1);
  expect(await page.locator("#browser .ht_master tbody tr").count()).toBe(1);
});
