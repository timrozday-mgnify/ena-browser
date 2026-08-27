import { expect, test } from "@playwright/test";
import { openDemo, visibleCount } from "./helpers.js";

/** The badge values in the pinned Reads column, top to bottom. */
async function reads(page: import("@playwright/test").Page): Promise<string[]> {
  return page.locator("#browser .ht_clone_inline_start .ena-browser-badge-value").allTextContents();
}

test("the pinned custom column updates in place, keeping selection", async ({ page }) => {
  await openDemo(page, { entity: "samples", selection: "multi" });
  expect(await reads(page)).toEqual(["0", "0", "0"]);

  await page
    .locator("#browser .ht_clone_inline_start tbody tr")
    .nth(0)
    .locator("td")
    .first()
    .click();
  await page.locator("#add-read").click();
  await page.locator("#add-read").click();

  await expect.poll(() => reads(page)).toEqual(["2", "0", "0"]);
  expect(
    await page.evaluate(() =>
      (
        document.getElementById("browser") as unknown as {
          getSelection(): string[];
        }
      ).getSelection(),
    ),
  ).toEqual(["ERS4000001"]);
});

test("custom values survive filtering and never enter the change set", async ({ page }) => {
  await openDemo(page, { entity: "samples", selection: "multi" });
  await page
    .locator("#browser .ht_clone_inline_start tbody tr")
    .nth(2)
    .locator("td")
    .first()
    .click();
  await page.locator("#add-read").click();

  await page.locator('[data-role="quick-filter"]').fill("soil");
  await expect.poll(() => visibleCount(page)).toBe(1);
  await expect.poll(() => reads(page)).toEqual(["1"]);

  await page.locator('[data-role="quick-filter"]').fill("");
  await expect.poll(() => reads(page)).toEqual(["0", "0", "1"]);

  expect(
    await page.evaluate(
      () =>
        (
          document.getElementById("browser") as unknown as {
            getChangeSet(): { rows: unknown[] };
          }
        ).getChangeSet().rows,
    ),
  ).toEqual([]);
  expect(
    await page.evaluate(
      () =>
        (
          document.getElementById("browser") as unknown as {
            getRows(): Record<string, unknown>[];
          }
        ).getRows()[0]?.["reads_assigned"],
    ),
  ).toBeUndefined();
});
