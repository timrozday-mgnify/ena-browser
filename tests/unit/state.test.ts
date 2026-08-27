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
    selectionMode: "multi",
    ...config,
  });
  grids.push(grid);
  return grid;
}

/** What a host's undo stack does: an edit, expressed as a ChangeSet row. */
function titleEdit(key: string, before: string, after: string) {
  return {
    key,
    accession: key,
    before: { title: before },
    after: { title: after },
    changed: ["title"],
  };
}

afterEach(() => {
  while (grids.length) grids.pop()?.destroy();
  document.body.innerHTML = "";
});

describe("undo/redo compatibility", () => {
  it("round-trips a snapshot", () => {
    const grid = makeGrid();
    grid.setEdits([titleEdit("ERS1", "One", "Edited")]);
    grid.setSelection(["ERS2"]);
    grid.setSort([{ column: "title", order: "desc" }]);
    grid.setFilters([{ column: "status", operator: "eq", value: "PRIVATE" }]);

    const snapshot = JSON.parse(JSON.stringify(grid.getState()));
    grid.setState({ edits: [], layout: {}, filters: [], sort: [], selection: [] });
    expect(grid.getRows()[0]?.["title"]).toBe("One");

    grid.setState(snapshot);
    expect(grid.getState()).toEqual(snapshot);
    expect(grid.getRows()[0]?.["title"]).toBe("Edited");
  });

  it("rewinds cells the target state does not edit", () => {
    const grid = makeGrid();
    grid.setEdits([titleEdit("ERS1", "One", "A"), titleEdit("ERS2", "Two", "B")]);
    grid.setEdits([titleEdit("ERS1", "One", "A")]);

    expect(grid.getRows().map((row) => row["title"])).toEqual(["A", "Two"]);
    expect(grid.getChangeSet().rows).toHaveLength(1);
  });

  it("stamps events so a host can tell replay from a gesture", () => {
    const grid = makeGrid();
    const sources: string[] = [];
    for (const name of ["change", "selection-change", "filter-change"]) {
      grid.addEventListener(name, (event) => {
        sources.push((event as CustomEvent).detail.source);
      });
    }

    grid.setSelection(["ERS1"]);
    expect(sources).toEqual(["user"]);

    sources.length = 0;
    grid.setState({ edits: [titleEdit("ERS1", "One", "A")], selection: [], sort: [] });
    expect(sources.length).toBeGreaterThan(0);
    expect(new Set(sources)).toEqual(new Set(["api"]));
  });

  it("drops edits for rows that are no longer present", () => {
    const grid = makeGrid();
    grid.setEdits([titleEdit("ERS1", "One", "A"), titleEdit("GONE", "x", "y")]);
    expect(grid.getChangeSet().rows.map((row) => row.key)).toEqual(["ERS1"]);
  });
});
