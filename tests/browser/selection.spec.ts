/**
 * The pairing contract: the host records `lastKey` and pairs it with the next
 * click elsewhere. These must not be flaky.
 */
import { expect, test } from "@playwright/test";
import { openDemo, visibleCount } from "./helpers.js";

type SelectionDetail = { keys: string[]; lastKey: string | null };

async function lastSelectionEvent(
  page: import("@playwright/test").Page,
): Promise<SelectionDetail | null> {
  return page.evaluate(
    () => (window as unknown as { __lastSelection?: SelectionDetail }).__lastSelection ?? null,
  );
}

async function watchSelection(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => {
    document.addEventListener("ena-browser:selection-change", (event) => {
      (window as unknown as { __lastSelection?: unknown }).__lastSelection = (
        event as CustomEvent
      ).detail;
    });
  });
}

/** The selection checkbox lives in the frozen left overlay, column 0. */
function checkbox(page: import("@playwright/test").Page, row: number) {
  return page.locator("#browser .ht_clone_inline_start tbody tr").nth(row).locator("td").first();
}

test("multi mode accumulates keys in click order", async ({ page }) => {
  await openDemo(page, { entity: "samples", selection: "multi" });
  await watchSelection(page);

  await checkbox(page, 1).click();
  await checkbox(page, 0).click();

  await expect
    .poll(() => lastSelectionEvent(page))
    .toMatchObject({
      keys: ["ERS4000002", "ERS4000001"],
      lastKey: "ERS4000001",
    });
});

test("single mode keeps one key and reports it as lastKey", async ({ page }) => {
  await openDemo(page, { entity: "samples", selection: "single" });
  await watchSelection(page);

  await checkbox(page, 0).click();
  await checkbox(page, 2).click();

  await expect
    .poll(() => lastSelectionEvent(page))
    .toMatchObject({
      keys: ["SAMEA4000003"],
      lastKey: "SAMEA4000003",
    });
});

test("selection survives a filter change and a custom-value update", async ({ page }) => {
  await openDemo(page, { entity: "samples", selection: "multi" });
  await checkbox(page, 0).click();
  await checkbox(page, 1).click();

  await page.locator('[data-role="quick-filter"]').fill("donor A");
  await expect.poll(() => visibleCount(page)).toBe(1);
  await page.locator("#add-read").click();

  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          document.getElementById("browser") as unknown as {
            getSelection(): string[];
          }
        ).getSelection(),
      ),
    )
    .toEqual(["ERS4000001", "ERS4000002"]);
});

test("Clear selection empties it", async ({ page }) => {
  await openDemo(page, { entity: "samples", selection: "multi" });
  await checkbox(page, 0).click();
  await expect(page.locator(".ena-browser-selection-count")).toHaveText("1 selected");
  await page.locator('[data-role="clear-selection"]').click();
  await expect(page.locator(".ena-browser-selection-count")).toHaveText("0 selected");
});
