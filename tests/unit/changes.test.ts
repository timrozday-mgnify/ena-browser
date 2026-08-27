import { describe, expect, it } from "vitest";
import { ChangeTracker, diffRow } from "../../src/changes.js";

describe("diffRow", () => {
  it("reports only editable columns that differ", () => {
    const before = { title: "old", alias: "a", status: "PRIVATE" };
    const after = { title: "new", alias: "b", status: "PRIVATE" };
    expect(diffRow(before, after, ["title", "status"])).toEqual({
      changed: ["title"],
    });
  });

  it("treats null, undefined and empty string as equal", () => {
    expect(diffRow({ title: null }, { title: "" }, ["title"]).changed).toEqual([]);
    expect(diffRow({}, { title: undefined }, ["title"]).changed).toEqual([]);
  });

  it("compares numbers and their string form as equal", () => {
    expect(diffRow({ depth: 3 }, { depth: "3" }, ["depth"]).changed).toEqual([]);
  });
});

describe("ChangeTracker", () => {
  it("records an edit", () => {
    const tracker = new ChangeTracker();
    tracker.record("ERS1", "title", "old", "new");
    expect(tracker.get()).toEqual({
      rows: [
        {
          key: "ERS1",
          accession: "ERS1",
          before: { title: "old" },
          after: { title: "new" },
          changed: ["title"],
        },
      ],
    });
    expect(tracker.size).toBe(1);
  });

  it("drops a cell reverted to its original value", () => {
    const tracker = new ChangeTracker();
    tracker.record("ERS1", "title", "old", "new");
    tracker.record("ERS1", "title", "new", "old");
    expect(tracker.get().rows).toEqual([]);
    expect(tracker.size).toBe(0);
    expect(tracker.hasChange("ERS1", "title")).toBe(false);
  });

  it("keeps the original `before` across successive edits of one cell", () => {
    const tracker = new ChangeTracker();
    tracker.record("ERS1", "title", "old", "mid");
    tracker.record("ERS1", "title", "mid", "final");
    expect(tracker.get().rows[0]).toMatchObject({
      before: { title: "old" },
      after: { title: "final" },
    });
  });

  it("keeps other columns when one is reverted", () => {
    const tracker = new ChangeTracker();
    tracker.record("ERS1", "title", "old", "new");
    tracker.record("ERS1", "alias", "a", "b");
    tracker.record("ERS1", "title", "new", "old");
    expect(tracker.changedColumns("ERS1")).toEqual(["alias"]);
  });

  it("tracks the accession separately from the row key", () => {
    const tracker = new ChangeTracker();
    tracker.record("sample-alias", "title", "old", "new", "ERS7");
    expect(tracker.get().rows[0]?.accession).toBe("ERS7");
  });

  it("clears", () => {
    const tracker = new ChangeTracker();
    tracker.record("ERS1", "title", "old", "new");
    tracker.clear();
    expect(tracker.get().rows).toEqual([]);
  });
});
