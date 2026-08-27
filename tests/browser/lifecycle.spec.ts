import { expect, test } from "@playwright/test";
import { openDemo } from "./helpers.js";

test("removing the element destroys the Handsontable instance", async ({ page }) => {
  await openDemo(page, { entity: "samples" });

  const result = await page.evaluate(() => {
    const element = document.getElementById("browser") as HTMLElement & {
      getRows(): unknown[];
    };
    element.remove();
    return {
      children: element.children.length,
      tables: document.querySelectorAll(".handsontable").length,
      rows: element.getRows().length,
    };
  });

  expect(result.children).toBe(0);
  expect(result.tables).toBe(0);
  expect(result.rows).toBe(0);
});

test("re-attaching builds exactly one grid", async ({ page }) => {
  await openDemo(page, { entity: "samples" });
  const tables = await page.evaluate(() => {
    const element = document.getElementById("browser") as HTMLElement & {
      config: unknown;
    };
    for (let i = 0; i < 3; i += 1) {
      element.remove();
      document.body.appendChild(element);
    }
    return document.querySelectorAll("#browser .ht-root-wrapper").length;
  });
  expect(tables).toBe(1);
});
