import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

export async function openDemo(
  page: Page,
  options: {
    entity?: string;
    mode?: "read" | "edit";
    selection?: "none" | "single" | "multi";
  } = {},
): Promise<void> {
  await page.goto("/demo/index.html");
  await expect(page.locator("#browser .handsontable").first()).toBeVisible();
  if (options.entity) {
    await page.selectOption("#entity", options.entity);
  }
  if (options.selection) {
    await page.selectOption("#selection-mode", options.selection);
  }
  if (options.mode) {
    await page.selectOption("#mode", options.mode);
  }
  await expect(page.locator("#browser .handsontable").first()).toBeVisible();
}

/**
 * Every column header, in display order. Blank headers (the selection and
 * row-action columns) drop out.
 *
 * Handsontable virtualises columns: only what fits the viewport is in the DOM.
 * Specs that assert on the full set widen the viewport with `test.use()` so
 * every column fits — scrolling the overlays from a test is unreliable.
 */
export async function headers(page: Page): Promise<string[]> {
  const texts = await page.locator("#browser .ht_clone_top thead span.colHeader").allTextContents();
  return texts.map((t) => t.trim()).filter((t) => t !== "");
}

/** Every rendered cell value in one named column, top overlay included. */
export async function columnValues(page: Page, column: string): Promise<string[]> {
  return page.evaluate((name) => {
    const element = document.getElementById("browser") as unknown as {
      getVisibleRows(): Record<string, unknown>[];
    };
    return element.getVisibleRows().map((row) => String(row[name] ?? ""));
  }, column);
}

export async function visibleCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const element = document.getElementById("browser") as unknown as {
      getVisibleRows(): unknown[];
    };
    return element.getVisibleRows().length;
  });
}

/** Rows Handsontable is actually painting (its own filtering, not ours). */
export async function renderedRowCount(page: Page): Promise<number> {
  return page.locator("#browser .ht_master tbody tr").count();
}
