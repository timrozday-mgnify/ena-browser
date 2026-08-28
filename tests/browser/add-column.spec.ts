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
  // Every column can be deleted; an added one needs no confirmation.
  await expect(menu.locator('[data-role="delete-column"][data-column="host_diet"]')).toHaveCount(1);

  await menu.locator('[data-role="delete-column"][data-column="host_diet"]').click();
  expect(await headers(page)).not.toContain("Host diet");
});

test("deletes a report column, after confirming, and discards it back", async ({ page }) => {
  await openDemo(page, { entity: "samples", mode: "edit" });
  await page.locator('[data-role="columns"]').click();
  const menu = page.locator('[data-role="columns-menu"]');

  page.once("dialog", (dialog) => dialog.dismiss());
  await menu.locator('[data-role="delete-column"][data-column="title"]').click();
  expect(await headers(page)).toContain("Title");

  page.once("dialog", (dialog) => dialog.accept());
  await menu.locator('[data-role="delete-column"][data-column="title"]').click();
  expect(await headers(page)).not.toContain("Title");

  // Deleting it is a pending edit: the field is cleared in ENA, not hidden.
  await page.locator('[data-role="discard"]').click();
  expect(await headers(page)).toContain("Title");
});
