import { expect, test } from "@playwright/test";
import { headers, openDemo } from "./helpers.js";

test.use({ viewport: { width: 2200, height: 900 } });

test("adds a column from the Columns menu and deletes it again", async ({ page }) => {
  await openDemo(page, { entity: "samples", mode: "edit" });
  await page.locator('[data-role="columns"]').click();

  const menu = page.locator('[data-role="columns-menu"]');
  await menu.locator('[data-role="new-column"]').fill("host_diet");
  await menu.locator('[data-role="add-column"]').click();

  expect(await headers(page)).toContain("Host diet");
  // Report columns have no Delete button; added ones do.
  await expect(menu.locator('[data-role="delete-column"]')).toHaveCount(1);

  await menu.locator('[data-role="delete-column"][data-column="host_diet"]').click();
  expect(await headers(page)).not.toContain("Host diet");
});
