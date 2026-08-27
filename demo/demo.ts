/**
 * The demo page: fixtures or live ENA, every event echoed into a panel, and a
 * "+1 read" button proving the custom-column pairing mechanism end to end.
 *
 * This is also the seed of the standalone report browser, and the page the
 * Playwright suite drives.
 */

import "../src/index.js";
import type { EnaBrowserElement } from "../src/element.js";
import { enaReportsSource } from "../src/sources/enaReports.js";
import type { Entity, Row } from "../src/types.js";

import analyses from "../tests/fixtures/analyses.json";
import experiments from "../tests/fixtures/experiments.json";
import files from "../tests/fixtures/files.json";
import runs from "../tests/fixtures/runs.json";
import samples from "../tests/fixtures/samples.json";
import studies from "../tests/fixtures/studies.json";

const FIXTURES: Record<Entity, Row[]> = {
  studies,
  samples,
  runs,
  experiments,
  analyses,
  files,
};

const browser = document.getElementById("browser") as EnaBrowserElement;
const log = document.getElementById("events") as HTMLPreElement;
const entitySelect = document.getElementById("entity") as HTMLSelectElement;
const modeSelect = document.getElementById("mode") as HTMLSelectElement;
const selectionSelect = document.getElementById("selection-mode") as HTMLSelectElement;
const enaStatus = document.getElementById("ena-status") as HTMLSpanElement;

const readsAssigned = new Map<string, number>();

function currentEntity(): Entity {
  return entitySelect.value as Entity;
}

function record(name: string, detail: unknown): void {
  const line = `${new Date().toISOString().slice(11, 19)}  ${name}  ${JSON.stringify(detail)}`;
  log.textContent = `${line}\n${log.textContent === "events appear here" ? "" : log.textContent}`;
}

for (const name of [
  "ready",
  "selection-change",
  "change",
  "filter-change",
  "layout-change",
  "row-action",
  "error",
]) {
  browser.addEventListener(`ena-browser:${name}`, (event) => {
    record(name, (event as CustomEvent).detail);
  });
}

function configure(rows: Row[]): void {
  browser.config = {
    entity: currentEntity(),
    mode: modeSelect.value as "read" | "edit",
    selectionMode: selectionSelect.value as "none" | "single" | "multi",
    rows,
    editableColumns: ["title", "alias"],
    rowActions: [
      { action: "release", label: "Release", title: "Release this record" },
      { action: "cancel", label: "Cancel", title: "Cancel this record" },
    ],
    customColumns: [
      {
        name: "reads_assigned",
        title: "Reads",
        type: "numeric",
        render: "badge",
        default: 0,
      },
    ],
  };
  browser.setCustomValues("reads_assigned", readsAssigned);
}

function loadFixtures(): void {
  readsAssigned.clear();
  configure(FIXTURES[currentEntity()] ?? []);
}

document.getElementById("load-fixtures")?.addEventListener("click", loadFixtures);
entitySelect.addEventListener("change", loadFixtures);
modeSelect.addEventListener("change", () =>
  browser.applyConfig({ mode: modeSelect.value as "read" | "edit" }),
);
selectionSelect.addEventListener("change", () =>
  browser.applyConfig({
    selectionMode: selectionSelect.value as "none" | "single" | "multi",
  }),
);

document.getElementById("add-read")?.addEventListener("click", () => {
  for (const key of browser.getSelection()) {
    readsAssigned.set(key, (readsAssigned.get(key) ?? 0) + 1);
  }
  browser.setCustomValues("reads_assigned", readsAssigned);
});

document.getElementById("clear-events")?.addEventListener("click", () => {
  log.textContent = "events appear here";
});

document.getElementById("load-ena")?.addEventListener("click", async () => {
  const username = (document.getElementById("webin-id") as HTMLInputElement).value;
  const password = (document.getElementById("webin-password") as HTMLInputElement).value;
  const test = (document.getElementById("webin-test") as HTMLInputElement).checked;
  enaStatus.textContent = "loading…";
  browser.applyConfig({
    source: enaReportsSource({ username, password, test }),
  });
  await browser.refresh();
  enaStatus.textContent = `${browser.getRows().length} rows`;
});

loadFixtures();
