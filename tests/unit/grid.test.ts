import { afterEach, describe, expect, it, vi } from "vitest";
import { EnaGrid } from "../../src/grid.js";
import type { EnaBrowserConfig, Row } from "../../src/types.js";

const rows: Row[] = [
  { accession: "ERS1", alias: "s1", title: "One", status: "PRIVATE" },
  { accession: "ERS2", alias: "s2", title: "Two", status: "CANCELLED" },
  { secondary_accession: "SAMEA3", alias: "s3", title: "Three", status: "PUBLIC" },
];

const grids: EnaGrid[] = [];

function makeGrid(config: Partial<EnaBrowserConfig> = {}): EnaGrid {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const grid = new EnaGrid(container, {
    entity: "samples",
    rows,
    statusFilter: { excludeCancelled: false, excludeSuppressed: false },
    ...config,
  });
  grids.push(grid);
  return grid;
}

afterEach(() => {
  while (grids.length) grids.pop()?.destroy();
  document.body.innerHTML = "";
});

describe("EnaGrid construction", () => {
  it("mounts and reports its columns", () => {
    const grid = makeGrid();
    expect(grid.listColumns().map((c) => c.name)).toContain("accession");
    expect(grid.getRows()).toHaveLength(3);
  });

  it("destroys the Handsontable instance", () => {
    const grid = makeGrid();
    expect(grid.isDestroyed).toBe(false);
    grid.destroy();
    expect(grid.isDestroyed).toBe(true);
  });
});

describe("filters and visible rows", () => {
  it("hides cancelled rows by default", () => {
    const grid = makeGrid({ statusFilter: undefined });
    expect(grid.getVisibleRows().map((r) => r["alias"])).toEqual(["s1", "s3"]);
  });

  it("applies programmatic filters", () => {
    const grid = makeGrid();
    grid.setFilters([{ column: "title", operator: "contains", value: "o" }]);
    expect(grid.getVisibleRows().map((r) => r["alias"])).toEqual(["s1", "s2"]);
  });

  it("quick-filters across text columns", () => {
    const grid = makeGrid();
    grid.setQuickFilter("three");
    expect(grid.getVisibleRows().map((r) => r["alias"])).toEqual(["s3"]);
  });

  it("emits filter-change with the visible count", () => {
    const grid = makeGrid();
    const seen = vi.fn();
    grid.addEventListener("filter-change", (event) => {
      seen((event as CustomEvent).detail.visibleCount);
    });
    grid.setFilters([{ column: "status", operator: "eq", value: "PUBLIC" }]);
    expect(seen).toHaveBeenCalledWith(1);
  });

  it("sorts visible rows", () => {
    const grid = makeGrid();
    grid.setSort([{ column: "title", order: "desc" }]);
    expect(grid.getVisibleRows().map((r) => r["title"])).toEqual(["Two", "Three", "One"]);
  });
});

describe("selection", () => {
  it("keeps keys in click order and reports lastKey", () => {
    const grid = makeGrid({ selectionMode: "multi" });
    const events: unknown[] = [];
    grid.addEventListener("selection-change", (event) =>
      events.push((event as CustomEvent).detail),
    );
    grid.setSelection(["ERS2", "ERS1"]);
    expect(grid.getSelection()).toEqual(["ERS2", "ERS1"]);
    expect(events.at(-1)).toMatchObject({ lastKey: "ERS1" });
  });

  it("keeps one key in single mode", () => {
    const grid = makeGrid({ selectionMode: "single" });
    grid.setSelection(["ERS1", "ERS2"]);
    expect(grid.getSelection()).toEqual(["ERS1"]);
  });

  it("drops keys that are no longer in the data", () => {
    const grid = makeGrid({ selectionMode: "multi" });
    grid.setSelection(["ERS1", "ERS2"]);
    grid.setRows([rows[0] as Row]);
    expect(grid.getSelection()).toEqual(["ERS1"]);
  });
});

describe("custom columns", () => {
  const customColumns = [{ name: "reads_assigned", title: "Reads", type: "numeric" as const }];

  it("patches values without touching rows, sort or selection", () => {
    const grid = makeGrid({ selectionMode: "multi", customColumns });
    grid.setSelection(["ERS1"]);
    grid.setSort([{ column: "title", order: "asc" }]);

    grid.setCustomValues("reads_assigned", { ERS1: 2, SAMEA3: 1 });

    expect(grid.getCustomValues("reads_assigned").get("ERS1")).toBe(2);
    expect(grid.getSelection()).toEqual(["ERS1"]);
    expect(grid.getSort()).toEqual([{ column: "title", order: "asc" }]);
    expect(grid.getRows()[0]).not.toHaveProperty("reads_assigned");
    expect(grid.getChangeSet().rows).toEqual([]);
  });

  it("merges rather than replaces", () => {
    const grid = makeGrid({ customColumns });
    grid.setCustomValues("reads_assigned", { ERS1: 2 });
    grid.setCustomValues("reads_assigned", new Map([["ERS2", 5]]));
    expect([...grid.getCustomValues("reads_assigned").entries()]).toEqual([
      ["ERS1", 2],
      ["ERS2", 5],
    ]);
  });

  it("rejects an unknown column", () => {
    const grid = makeGrid();
    expect(() => grid.setCustomValues("nope", {})).toThrow(/unknown custom/);
  });

  it("pins custom columns first by default", () => {
    const grid = makeGrid({ customColumns });
    expect(grid.isPinned("reads_assigned")).toBe(true);
    expect(grid.listColumns()[0]?.name).toBe("reads_assigned");
  });
});

describe("layout", () => {
  it("round-trips through getLayout/setLayout by name", () => {
    const grid = makeGrid();
    grid.pin("title");
    grid.hideColumn("alias");
    const layout = grid.getLayout();
    expect(layout.pinned).toEqual(["title"]);

    const fresh = makeGrid();
    fresh.setLayout(layout);
    expect(fresh.getLayout()).toEqual(layout);
    expect(fresh.isPinned("title")).toBe(true);
    expect(fresh.isHidden("alias")).toBe(true);
  });

  it("unpins and shows again", () => {
    const grid = makeGrid();
    grid.pin("title");
    grid.unpin("title");
    grid.hideColumn("alias");
    grid.showColumn("alias");
    expect(grid.getLayout()).toMatchObject({ pinned: [], hidden: [] });
  });
});

describe("edit tracking", () => {
  it("ignores edits in read mode", () => {
    const grid = makeGrid();
    expect(grid.getMode()).toBe("read");
    expect(grid.getChangeSet().rows).toEqual([]);
  });

  it("restores values on discard", () => {
    const grid = makeGrid({ mode: "edit", editableColumns: ["title"] });
    const row = grid.getRows()[0] as Row;
    // simulate what afterChange records for a committed edit
    row["title"] = "Edited";
    grid.setRows(grid.getRows());
    expect(grid.getRows()[0]?.["title"]).toBe("Edited");
    grid.discardChanges();
    expect(grid.getChangeSet().rows).toEqual([]);
  });
});

describe("row actions", () => {
  const rowActions = [
    { action: "release", label: "Release" },
    { action: "cancel", label: "Cancel", title: "Cancel this record" },
  ];

  it("renders one button per spec and emits row-action on click", () => {
    const grid = makeGrid({ rowActions });
    const seen: unknown[] = [];
    grid.addEventListener("row-action", (event) => seen.push((event as CustomEvent).detail));

    // A frozen column is painted twice: once in the master overlay, once in
    // the visible frozen clone. Count the clone.
    const buttons = document.querySelectorAll<HTMLButtonElement>(
      ".ht_clone_inline_start button[data-ena-action]",
    );
    expect(buttons.length).toBe(rows.length * rowActions.length);
    expect(buttons[0]?.textContent).toBe("Release");
    expect(buttons[1]?.title).toBe("Cancel this record");

    buttons[0]?.click();
    expect(seen).toEqual([{ action: "release", key: "ERS1", row: rows[0] }]);
  });

  it("keys buttons by the row key, accession or not", () => {
    makeGrid({ rowActions });
    const keys = [
      ...document.querySelectorAll<HTMLButtonElement>(
        ".ht_clone_inline_start button[data-ena-action='release']",
      ),
    ].map((button) => button.dataset["enaKey"]);
    expect(keys).toEqual(["ERS1", "ERS2", "SAMEA3"]);
  });

  it("draws no column when no actions are configured", () => {
    makeGrid();
    expect(document.querySelectorAll("button[data-ena-action]")).toHaveLength(0);
  });

  it("keeps the actions column out of the layout and the columns list", () => {
    const grid = makeGrid({ rowActions });
    expect(grid.listColumns().map((c) => c.name)).not.toContain("__actions__");
    expect(grid.getLayout().order).not.toContain("__actions__");
    grid.pin("__actions__");
    expect(grid.getLayout().pinned).toEqual([]);
  });
});
