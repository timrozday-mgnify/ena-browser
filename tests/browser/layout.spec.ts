import { expect, test } from "@playwright/test";
import { headers, openDemo } from "./helpers.js";

async function getLayout(page: import("@playwright/test").Page): Promise<{
  order?: string[];
  pinned?: string[];
  hidden?: string[];
}> {
  return page.evaluate(() =>
    (
      document.getElementById("browser") as unknown as {
        getLayout(): Record<string, unknown>;
      }
    ).getLayout(),
  );
}

test("pinning through the Columns menu freezes the column", async ({ page }) => {
  await openDemo(page, { entity: "samples" });
  await page.locator('[data-role="columns"]').click();
  const menu = page.locator('[data-role="columns-menu"]');
  await expect(menu).toBeVisible();
  await menu.locator("div", { hasText: "Status" }).getByRole("button", { name: "Pin" }).click();

  expect((await getLayout(page)).pinned).toContain("status");
  // A pinned column renders in the frozen corner overlay.
  await expect(
    page.locator("#browser .ht_clone_top_inline_start_corner span.colHeader", {
      hasText: "Status",
    }),
  ).toBeVisible();
});

test("a pinned column stays put while scrolling right", async ({ page }) => {
  await openDemo(page, { entity: "samples" });
  const reads = page.locator("#browser .ht_clone_inline_start td").first();
  const before = await reads.boundingBox();
  await page.locator("#browser .ht_master .wtHolder").evaluate((element) => {
    element.scrollLeft = 400;
  });
  await page.waitForTimeout(200);
  const after = await reads.boundingBox();
  expect(after?.x).toBeCloseTo(before?.x ?? 0, 0);
});

test("hiding and showing a column through the Columns menu", async ({ page }) => {
  await openDemo(page, { entity: "samples" });
  expect(await headers(page)).toContain("Alias");

  await page.locator('[data-role="columns"]').click();
  const alias = page.locator('[data-role="columns-menu"] div').filter({ hasText: "Alias" }).first();
  await alias.locator("input[type=checkbox]").uncheck();
  await expect.poll(() => headers(page)).not.toContain("Alias");
  expect((await getLayout(page)).hidden).toContain("alias");

  await alias.locator("input[type=checkbox]").check();
  await expect.poll(() => headers(page)).toContain("Alias");
});

test("getLayout → setLayout reproduces the layout on a fresh element", async ({ page }) => {
  await openDemo(page, { entity: "samples" });
  await page.evaluate(() => {
    const element = document.getElementById("browser") as unknown as {
      setLayout(layout: unknown): void;
    };
    element.setLayout({
      order: ["status", "title", "alias", "accession"],
      pinned: ["status"],
      hidden: ["secondary_accession"],
      widths: { title: 240 },
    });
  });
  const layout = await getLayout(page);

  const reproduced = await page.evaluate((saved) => {
    document.getElementById("browser")?.remove();
    const fresh = document.createElement("ena-browser") as unknown as {
      config: unknown;
      setLayout(layout: unknown): void;
      getLayout(): unknown;
    };
    fresh.config = {
      entity: "samples",
      rows: [
        { accession: "ERS1", secondary_accession: "S1", alias: "a", title: "t", status: "PRIVATE" },
      ],
    };
    document.body.appendChild(fresh as unknown as HTMLElement);
    fresh.setLayout(saved);
    return fresh.getLayout();
  }, layout);

  expect(reproduced).toMatchObject({
    pinned: ["status"],
    hidden: ["secondary_accession"],
  });
});

test("dragging a column header reorders it", async ({ page }) => {
  await openDemo(page, { entity: "samples" });
  const before = await headers(page);

  const source = page.locator("#browser .ht_clone_top th", {
    hasText: "Title",
  });
  const target = page.locator("#browser .ht_clone_top th", {
    hasText: "Secondary accession",
  });
  const from = (await source.boundingBox()) ?? null;
  const to = (await target.boundingBox()) ?? null;
  if (!from || !to) throw new Error("headers not laid out");

  // Handsontable's manualColumnMove is mouse-driven, and it ignores a
  // mousedown that lands on the header's sort element — so select the column
  // first, then press in the header's bottom-right corner.
  await page.mouse.click(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.move(from.x + from.width - 10, from.y + from.height - 3);
  await page.mouse.down();
  await page.mouse.move(to.x + 40, to.y + to.height / 2, { steps: 15 });
  await page.mouse.up();

  await expect
    .poll(() => headers(page))
    .toEqual(["Reads", "Accession", "Title", "Secondary accession", "Alias", "Status", "Tax id"]);
  expect((await headers(page)).sort()).toEqual([...before].sort());
  expect((await getLayout(page)).order?.slice(0, 7)).toEqual([
    "reads_assigned",
    "accession",
    "title",
    "secondary_accession",
    "alias",
    "status",
    "tax_id",
  ]);
});
