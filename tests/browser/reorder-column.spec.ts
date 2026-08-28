import { expect, test } from "@playwright/test";
import { headers, openDemo } from "./helpers.js";

test.use({ viewport: { width: 2200, height: 900 } });

const order = (page: import("@playwright/test").Page): Promise<string[]> =>
  page
    .locator('[data-role="columns-menu"] [data-role="column-row"]')
    .evaluateAll((rows) => rows.map((row) => (row as HTMLElement).dataset["column"] ?? ""));

test("drags a column to a new position in the Columns menu", async ({ page }) => {
  await openDemo(page, { entity: "samples" });
  await page.locator('[data-role="columns"]').click();

  const before = await order(page);
  const headersBefore = await headers(page);
  const rows = page.locator('[data-role="columns-menu"] [data-role="column-row"]');
  await rows.first().locator(".ena-browser-drag-handle").dragTo(rows.nth(2));

  const after = await order(page);
  expect(after).not.toEqual(before);
  expect(after.indexOf(before[0] ?? "")).toBeGreaterThan(0);
  expect([...after].sort()).toEqual([...before].sort());
  // The grid itself follows the menu, not just the menu's own DOM.
  expect(await headers(page)).not.toEqual(headersBefore);
});
