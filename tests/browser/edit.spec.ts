import { expect, test } from "@playwright/test";
import { openDemo } from "./helpers.js";
import type { Page } from "@playwright/test";

type ChangeSet = {
  rows: {
    key: string;
    accession: string;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
    changed: string[];
  }[];
};

async function changeSet(page: Page): Promise<ChangeSet> {
  return page.evaluate(() =>
    (
      document.getElementById("browser") as unknown as {
        getChangeSet(): ChangeSet;
      }
    ).getChangeSet(),
  );
}

/**
 * Type into the cell holding `current` on the given visible row. Cells are
 * found by their present value rather than by index: the master overlay skips
 * the frozen columns, so index arithmetic is a trap.
 */
async function editCell(page: Page, current: string, row: number, value: string): Promise<void> {
  const cell = page
    .locator("#browser .ht_master tbody tr")
    .nth(row)
    .locator("td")
    .filter({ hasText: new RegExp(`^${current}$`) })
    .first();
  await cell.dblclick();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type(value);
  await page.keyboard.press("Enter");
}

test("read mode rejects typing", async ({ page }) => {
  await openDemo(page, { entity: "samples" });
  await editCell(page, "Gut metagenome, donor A", 0, "Should not stick");
  expect((await changeSet(page)).rows).toEqual([]);
  await expect(page.locator(".ena-browser-pill")).toHaveText("Read-only");
});

test("edit mode records a change and reverting clears it", async ({ page }) => {
  await openDemo(page, { entity: "samples", mode: "edit" });
  await expect(page.locator(".ena-browser-pill")).toHaveText("Editing");

  await editCell(page, "Gut metagenome, donor A", 0, "Edited title");
  const set = await changeSet(page);
  expect(set.rows).toHaveLength(1);
  expect(set.rows[0]).toMatchObject({
    key: "ERS4000001",
    accession: "ERS4000001",
    before: { title: "Gut metagenome, donor A" },
    after: { title: "Edited title" },
    changed: ["title"],
  });
  await expect(page.locator('[data-role="pending"]')).toHaveText("1 pending change");

  await editCell(page, "Edited title", 0, "Gut metagenome, donor A");
  expect((await changeSet(page)).rows).toEqual([]);
  await expect(page.locator('[data-role="pending"]')).toHaveText("0 pending changes");
});

test("non-editable columns stay locked in edit mode", async ({ page }) => {
  await openDemo(page, { entity: "samples", mode: "edit" });
  // The demo declares only title and alias editable.
  await editCell(page, "PRIVATE", 0, "PUBLIC");
  expect((await changeSet(page)).rows).toEqual([]);
});

test("Discard changes restores the values", async ({ page }) => {
  await openDemo(page, { entity: "samples", mode: "edit" });
  await editCell(page, "Gut metagenome, donor A", 0, "Edited title");
  expect((await changeSet(page)).rows).toHaveLength(1);

  await page.locator('[data-role="discard"]').click();
  expect((await changeSet(page)).rows).toEqual([]);
  const title = await page.evaluate(
    () =>
      (
        document.getElementById("browser") as unknown as {
          getRows(): Record<string, unknown>[];
        }
      ).getRows()[0]?.["title"],
  );
  expect(title).toBe("Gut metagenome, donor A");
});
