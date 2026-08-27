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

test("extra fields present in the data become columns", async ({ page }) => {
  await openDemo(page, { entity: "samples" });
  // `tax_id` is not in the default sample column set — it comes from the rows.
  expect(await headers(page)).toContain("Tax id");
});

test("the custom Reads column is pinned first", async ({ page }) => {
  await openDemo(page, { entity: "samples" });
  const shown = await headers(page);
  expect(shown[0]).toBe("Reads");
});
