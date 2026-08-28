import { expect, test } from "@playwright/test";
import { headers, openDemo, renderedRowCount } from "./helpers.js";

// Handsontable only renders the columns that fit: every column of every entity has to be in the DOM.
test.use({ viewport: { width: 2200, height: 900 } });

const EXPECTED: Record<string, string[]> = {
  studies: ["Accession", "Secondary accession", "Alias", "Title", "Status"],
  samples: ["Accession", "Secondary accession", "Alias", "Title", "Status"],
  runs: [
    "Accession",
    "Alias",
    "Experiment accession",
    "Study accession",
    "Sample accession",
    "Status",
  ],
  experiments: ["Accession", "Alias", "Title", "Study accession", "Sample accession", "Status"],
  analyses: ["Accession", "Alias", "Title", "Study accession", "Status"],
  files: ["Accession", "Run accession", "Filename"],
};

for (const [entity, expected] of Object.entries(EXPECTED)) {
  test(`${entity} render with the expected headers`, async ({ page }) => {
    await openDemo(page, { entity });
    const shown = await headers(page);
    for (const title of expected) expect(shown).toContain(title);
    expect(await renderedRowCount(page)).toBeGreaterThan(0);
  });
}

test("extra fields present in the data become columns, hidden until asked for", async ({
  page,
}) => {
  await openDemo(page, { entity: "samples" });
  // `tax_id` is not in the default sample column set — it comes from the rows,
  // so it starts hidden rather than crowding out the columns that identify a
  // record. Dropping it would be the bug; the columns menu is where it lives.
  expect(await headers(page)).not.toContain("Tax id");

  await page.locator('[data-role="columns"]').click();
  const taxId = page
    .locator('[data-role="columns-menu"] [data-role="column-row"]')
    .filter({ hasText: "Tax id" })
    .first();
  await expect(taxId).toBeVisible();
  await taxId.locator("input[type=checkbox]").check();
  await expect.poll(() => headers(page)).toContain("Tax id");
});

test("the custom Reads column is pinned first", async ({ page }) => {
  await openDemo(page, { entity: "samples" });
  const shown = await headers(page);
  expect(shown[0]).toBe("Reads");
});
