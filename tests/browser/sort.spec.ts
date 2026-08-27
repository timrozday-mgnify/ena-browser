import { expect, test } from "@playwright/test";
import { columnValues, openDemo } from "./helpers.js";

test("clicking a header sorts, clicking again reverses", async ({ page }) => {
  await openDemo(page, { entity: "samples" });
  const header = page
    .locator("#browser .ht_clone_top th", { hasText: "Alias" })
    .locator("span.colHeader");

  await header.click();
  await expect
    .poll(() => columnValues(page, "alias"))
    .toEqual(["mimicc-sample-A", "mimicc-sample-B", "mimicc-sample-C"]);

  await header.click();
  await expect
    .poll(() => columnValues(page, "alias"))
    .toEqual(["mimicc-sample-C", "mimicc-sample-B", "mimicc-sample-A"]);
});

test("multi-column sort keeps both keys", async ({ page }) => {
  await openDemo(page, { entity: "runs" });
  await page.evaluate(() => {
    (
      document.getElementById("browser") as unknown as {
        setSort(specs: unknown[]): void;
      }
    ).setSort([
      { column: "sample_accession", order: "asc" },
      { column: "accession", order: "desc" },
    ]);
  });
  expect(await columnValues(page, "accession")).toEqual(["ERR5000002", "ERR5000001", "ERR5000003"]);
});
