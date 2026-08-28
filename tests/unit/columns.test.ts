import { afterEach, describe, expect, it } from "vitest";
import { EnaGrid } from "../../src/grid.js";
import type { EnaBrowserConfig, Row } from "../../src/types.js";

const baseRows: Row[] = [
  { accession: "ERS1", alias: "s1", title: "One", status: "PRIVATE" },
  { accession: "ERS2", alias: "s2", title: "Two", status: "PRIVATE" },
];

const grids: EnaGrid[] = [];

function makeGrid(config: Partial<EnaBrowserConfig> = {}): EnaGrid {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const grid = new EnaGrid(container, {
    entity: "samples",
    rows: baseRows.map((row) => ({ ...row })),
    mode: "edit",
    editableColumns: ["title"],
    ...config,
  });
  grids.push(grid);
  return grid;
}

const edit = (key: string, column: string, before: unknown, after: unknown) => ({
  key,
  accession: key,
  before: { [column]: before },
  after: { [column]: after },
  changed: [column],
});

afterEach(() => {
  while (grids.length) grids.pop()?.destroy();
  document.body.innerHTML = "";
});

describe("user-added columns", () => {
  it("adds an editable column and marks it deletable", () => {
    const grid = makeGrid();
    grid.addColumn({ name: "collection_date" });
    const spec = grid.listColumns().find((c) => c.name === "collection_date");
    expect(spec?.custom).toBe(true);
    expect(spec?.title).toBe("Collection date");
    expect(grid.getConfig().editableColumns).toContain("collection_date");
  });

  it("ignores a duplicate or empty name", () => {
    const grid = makeGrid();
    grid.addColumn({ name: "title" });
    grid.addColumn({ name: "  " });
    expect(grid.listColumns().filter((c) => c.name === "title")).toHaveLength(1);
    expect(grid.listColumns().some((c) => c.custom)).toBe(false);
  });

  it("puts its values in the change set, like any other edit", () => {
    const grid = makeGrid();
    grid.addColumn({ name: "host" });
    grid.setEdits([edit("ERS1", "host", undefined, "mouse")]);
    expect(grid.getChangeSet().rows[0]?.after).toEqual({ host: "mouse" });
  });

  it("deletes the column, its values and its edits", () => {
    const grid = makeGrid();
    grid.addColumn({ name: "host" });
    grid.setEdits([edit("ERS1", "host", undefined, "mouse")]);
    grid.removeColumn("host");

    expect(grid.listColumns().some((c) => c.name === "host")).toBe(false);
    expect(grid.getChangeSet().rows).toEqual([]);
    expect("host" in (grid.getRows()[0] as Row)).toBe(false);
    expect(grid.getConfig().editableColumns).not.toContain("host");
  });

  it("deleting a report column clears it in every row, for ENA to accept or refuse", () => {
    const grid = makeGrid();
    grid.removeColumn("title");

    expect(grid.listColumns().some((c) => c.name === "title")).toBe(false);
    const changed = grid.getChangeSet().rows;
    expect(changed.length).toBeGreaterThan(0);
    expect(changed[0]?.after).toEqual({ title: "" });
  });

  it("discarding the changes brings a deleted report column back", () => {
    const grid = makeGrid();
    grid.removeColumn("title");
    grid.discardChanges();

    expect(grid.listColumns().some((c) => c.name === "title")).toBe(true);
    expect(grid.getChangeSet().rows).toEqual([]);
  });
});

describe("include-in-modify column", () => {
  it("drops unticked rows from the change set but keeps them in the state", () => {
    const grid = makeGrid();
    grid.setEdits([edit("ERS1", "title", "One", "A"), edit("ERS2", "title", "Two", "B")]);
    grid.setExcluded(["ERS2"]);

    expect(grid.getChangeSet().rows.map((row) => row.key)).toEqual(["ERS1"]);
    expect(grid.pendingCount).toBe(1);
    expect(grid.getState().edits).toHaveLength(2);
  });

  it("round-trips through getState/setState", () => {
    const grid = makeGrid();
    grid.setEdits([edit("ERS1", "title", "One", "A"), edit("ERS2", "title", "Two", "B")]);
    grid.setExcluded(["ERS2"]);
    const snapshot = JSON.parse(JSON.stringify(grid.getState()));

    grid.setExcluded([]);
    expect(grid.getChangeSet().rows).toHaveLength(2);

    grid.setState(snapshot);
    expect(grid.getState()).toEqual(snapshot);
    expect(grid.getChangeSet().rows.map((row) => row.key)).toEqual(["ERS1"]);
  });
});
