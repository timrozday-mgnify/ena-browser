import { expect, test } from "@playwright/test";
import { openDemo } from "./helpers.js";
import type { Page } from "@playwright/test";

type RowActionDetail = { action: string; key: string; row: Record<string, unknown> };

async function watchRowActions(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __actions: unknown[] }).__actions = [];
    document.addEventListener("ena-browser:row-action", (event) => {
      (window as unknown as { __actions: unknown[] }).__actions.push((event as CustomEvent).detail);
    });
  });
}

async function firedActions(page: Page): Promise<RowActionDetail[]> {
  return page.evaluate(() => (window as unknown as { __actions: RowActionDetail[] }).__actions);
}

/** The visible buttons live in the frozen clone; the master paints a copy. */
function actionButtons(page: Page, row: number) {
  return page
    .locator("#browser .ht_clone_inline_start tbody tr")
    .nth(row)
    .locator("button[data-ena-action]");
}

test("the demo's row actions render one button per spec", async ({ page }) => {
  await openDemo(page, { entity: "samples" });
  await expect(actionButtons(page, 0)).toHaveText(["Release", "Cancel"]);
  await expect(actionButtons(page, 0).first()).toHaveAttribute("title", "Release this record");
});

test("clicking a button emits row-action with the row", async ({ page }) => {
  await openDemo(page, { entity: "samples" });
  await watchRowActions(page);

  await actionButtons(page, 1).nth(1).click();

  await expect.poll(() => firedActions(page)).toHaveLength(1);
  const [fired] = await firedActions(page);
  expect(fired).toMatchObject({ action: "cancel", key: "ERS4000002" });
  expect(fired?.row).toMatchObject({ alias: "mimicc-sample-B" });
});

test("the element performs no action of its own", async ({ page }) => {
  await openDemo(page, { entity: "samples" });
  const before = await page.evaluate(() =>
    JSON.stringify(
      (
        document.getElementById("browser") as unknown as {
          getRows(): unknown[];
        }
      ).getRows(),
    ),
  );

  await actionButtons(page, 0).first().click();

  const after = await page.evaluate(() =>
    JSON.stringify(
      (
        document.getElementById("browser") as unknown as {
          getRows(): unknown[];
        }
      ).getRows(),
    ),
  );
  expect(after).toBe(before);
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
});

test("action clicks do not change the selection", async ({ page }) => {
  await openDemo(page, { entity: "samples", selection: "single" });
  await actionButtons(page, 2).first().click();
  expect(
    await page.evaluate(() =>
      (
        document.getElementById("browser") as unknown as {
          getSelection(): string[];
        }
      ).getSelection(),
    ),
  ).toEqual([]);
});

test("row actions stay put and stay correct after filtering", async ({ page }) => {
  await openDemo(page, { entity: "samples" });
  await watchRowActions(page);

  await page.locator('[data-role="quick-filter"]').fill("soil");
  await expect(page.locator("#browser .ht_master tbody tr")).toHaveCount(1);

  await actionButtons(page, 0).first().click();
  await expect
    .poll(() => firedActions(page))
    .toMatchObject([{ action: "release", key: "SAMEA4000003" }]);
});
