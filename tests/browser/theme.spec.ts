import { expect, test } from "@playwright/test";
import { openDemo } from "./helpers.js";

/** The resolved theme is readable in two places: our attribute and HoT's class. */
async function themes(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const element = document.getElementById("browser") as HTMLElement & {
      resolvedTheme: string;
    };
    // `useTheme()` stamps the class on Handsontable's own root wrapper.
    const grid = element.querySelector(".ht-root-wrapper") as HTMLElement;
    return {
      attribute: element.dataset["theme"],
      resolved: element.resolvedTheme,
      dark: grid.classList.contains("ht-theme-main-dark"),
      light: grid.classList.contains("ht-theme-main"),
    };
  });
}

test("follows the page's data-theme while on auto", async ({ page }) => {
  await openDemo(page);
  expect(await themes(page)).toMatchObject({ resolved: "light", dark: false, light: true });

  await page.selectOption("#page-theme", "dark");
  await expect.poll(async () => (await themes(page)).resolved).toBe("dark");
  expect(await themes(page)).toMatchObject({ attribute: "dark", dark: true, light: false });
});

test("an explicit theme wins over the page and survives a page flip", async ({ page }) => {
  await openDemo(page);
  await page.selectOption("#theme", "dark");
  expect(await themes(page)).toMatchObject({ resolved: "dark", dark: true });

  await page.selectOption("#page-theme", "dark");
  await page.selectOption("#theme", "light");
  expect(await themes(page)).toMatchObject({ resolved: "light", light: true, dark: false });

  await page.selectOption("#theme", "auto");
  await expect.poll(async () => (await themes(page)).resolved).toBe("dark");
});

test("the portalled columns menu carries the theme", async ({ page }) => {
  await openDemo(page);
  await page.selectOption("#page-theme", "dark");
  await expect.poll(async () => (await themes(page)).resolved).toBe("dark");
  await page.click("#browser button:has-text('Columns')");
  await expect(page.locator("[data-role='columns-menu']")).toHaveAttribute("data-theme", "dark");
});

test("a theme the page isn't using drops the host's colours", async ({ page }) => {
  await openDemo(page);
  await page.selectOption("#page-theme", "dark");
  await page.selectOption("#theme", "light");

  const background = await page.evaluate(
    () => getComputedStyle(document.getElementById("browser") as HTMLElement).backgroundColor,
  );
  // The demo page defines a dark `--bg`; detached, the element ignores it.
  expect(background).toBe("rgb(255, 255, 255)");
  await expect(page.locator("#browser")).toHaveAttribute("data-theme-detached", "");

  await page.selectOption("#theme", "auto");
  await expect(page.locator("#browser")).not.toHaveAttribute("data-theme-detached", "");
});

test("the theme survives a structural rebuild", async ({ page }) => {
  await openDemo(page);
  await page.selectOption("#page-theme", "dark");
  await expect.poll(async () => (await themes(page)).resolved).toBe("dark");

  // A structural change throws the grid away and builds a new one.
  await page.evaluate(() => {
    (
      document.getElementById("browser") as HTMLElement & {
        applyConfig(partial: Record<string, unknown>): void;
      }
    ).applyConfig({ rowActions: [{ action: "poke", label: "Poke" }] });
  });
  expect(await themes(page)).toMatchObject({ resolved: "dark", dark: true, light: false });
});
