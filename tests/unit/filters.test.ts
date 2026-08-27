import { describe, expect, it } from "vitest";
import {
  applyFilters,
  fromHandsontableConditions,
  matchesFilter,
  statusFilterToSpec,
  toHandsontableCondition,
} from "../../src/filters.js";
import type { FilterSpec, Row } from "../../src/types.js";

const row: Row = {
  accession: "ERS100",
  alias: "sample-one",
  status: "PRIVATE",
  depth: 12,
  note: "",
};

describe("matchesFilter", () => {
  const cases: [FilterSpec, boolean][] = [
    [{ column: "accession", operator: "eq", value: "ERS100" }, true],
    [{ column: "accession", operator: "eq", value: "ERS999" }, false],
    [{ column: "accession", operator: "neq", value: "ERS999" }, true],
    [{ column: "alias", operator: "contains", value: "ple-o" }, true],
    [{ column: "alias", operator: "not_contains", value: "zzz" }, true],
    [{ column: "alias", operator: "begins", value: "sample" }, true],
    [{ column: "alias", operator: "ends", value: "one" }, true],
    [{ column: "status", operator: "in", values: ["PRIVATE", "PUBLIC"] }, true],
    [{ column: "status", operator: "not_in", values: ["CANCELLED"] }, true],
    [{ column: "note", operator: "empty" }, true],
    [{ column: "alias", operator: "not_empty" }, true],
    [{ column: "missing", operator: "empty" }, true],
    [{ column: "depth", operator: "gt", value: 5 }, true],
    [{ column: "depth", operator: "gte", value: 12 }, true],
    [{ column: "depth", operator: "lt", value: 12 }, false],
    [{ column: "depth", operator: "lte", value: 12 }, true],
    [{ column: "depth", operator: "between", values: [10, 20] }, true],
    [{ column: "depth", operator: "between", values: [20, 10] }, true],
    [{ column: "depth", operator: "between", values: [1, 5] }, false],
  ];

  it.each(cases)("%o → %s", (spec, expected) => {
    expect(matchesFilter(row, spec)).toBe(expected);
  });

  it("compares status case-insensitively", () => {
    expect(
      matchesFilter(
        { status: "private" },
        {
          column: "status",
          operator: "eq",
          value: "PRIVATE",
        },
      ),
    ).toBe(true);
  });

  it("in with an empty list matches nothing, not_in matches everything", () => {
    expect(matchesFilter(row, { column: "status", operator: "in", values: [] })).toBe(false);
    expect(matchesFilter(row, { column: "status", operator: "not_in", values: [] })).toBe(true);
  });
});

describe("applyFilters", () => {
  const rows: Row[] = [
    { accession: "A", status: "PRIVATE" },
    { accession: "B", status: "CANCELLED" },
    { accession: "C", status: "SUPPRESSED" },
  ];

  it("AND-s specs together", () => {
    const kept = applyFilters(rows, [
      { column: "status", operator: "not_in", values: ["CANCELLED"] },
      { column: "accession", operator: "neq", value: "C" },
    ]);
    expect(kept.map((r) => r["accession"])).toEqual(["A"]);
  });

  it("returns a copy when there are no specs", () => {
    const kept = applyFilters(rows, []);
    expect(kept).toEqual(rows);
    expect(kept).not.toBe(rows);
  });
});

describe("spec ↔ Handsontable condition", () => {
  const roundTrippable: FilterSpec[] = [
    { column: "accession", operator: "eq", value: "ERS1" },
    { column: "accession", operator: "neq", value: "ERS1" },
    { column: "alias", operator: "contains", value: "x" },
    { column: "alias", operator: "not_contains", value: "x" },
    { column: "alias", operator: "begins", value: "x" },
    { column: "alias", operator: "ends", value: "x" },
    { column: "status", operator: "in", values: ["PUBLIC", "PRIVATE"] },
    { column: "note", operator: "empty" },
    { column: "note", operator: "not_empty" },
    { column: "depth", operator: "gt", value: 1 },
    { column: "depth", operator: "gte", value: 1 },
    { column: "depth", operator: "lt", value: 1 },
    { column: "depth", operator: "lte", value: 1 },
    { column: "depth", operator: "between", values: [1, 9] },
  ];

  it.each(roundTrippable)("round-trips %o", (spec) => {
    const columns = ["accession", "alias", "status", "note", "depth"];
    const condition = toHandsontableCondition(spec);
    const back = fromHandsontableConditions(
      [{ column: columns.indexOf(spec.column), conditions: [condition] }],
      columns,
    );
    expect(back).toEqual([spec]);
  });

  it("normalises reversed between bounds on the way out", () => {
    expect(
      toHandsontableCondition({
        column: "depth",
        operator: "between",
        values: [9, 1],
      }),
    ).toEqual({ name: "between", args: [1, 9] });
  });

  // ponytail: Handsontable has no not_in — it becomes `by_value` over the complement,
  // so it round-trips back as `in`, which is the same filter.
  it("expresses not_in as `by_value` over the complement", () => {
    const condition = toHandsontableCondition(
      { column: "status", operator: "not_in", values: ["CANCELLED"] },
      ["PRIVATE", "CANCELLED", "PUBLIC"],
    );
    expect(condition).toEqual({ name: "by_value", args: [["PRIVATE", "PUBLIC"]] });
  });

  it("ignores unknown columns and conditions in the stack", () => {
    expect(
      fromHandsontableConditions(
        [
          { column: 99, conditions: [{ name: "eq", args: ["x"] }] },
          { column: 0, conditions: [{ name: "date_tomorrow", args: [] }] },
        ],
        ["accession"],
      ),
    ).toEqual([]);
  });

  it("rejects an unsupported operator", () => {
    expect(() =>
      toHandsontableCondition({
        column: "a",
        operator: "nope" as FilterSpec["operator"],
      }),
    ).toThrow(/unsupported/);
  });
});

describe("statusFilterToSpec", () => {
  it("defaults to excluding cancelled and suppressed", () => {
    expect(statusFilterToSpec(undefined, "samples")).toEqual({
      column: "status",
      operator: "not_in",
      values: ["CANCELLED", "SUPPRESSED"],
    });
  });

  it("honours the individual toggles", () => {
    expect(statusFilterToSpec({ excludeSuppressed: false }, "samples")).toEqual({
      column: "status",
      operator: "not_in",
      values: ["CANCELLED"],
    });
    expect(
      statusFilterToSpec({ excludeCancelled: false, excludeSuppressed: false }, "samples"),
    ).toBeNull();
  });

  it("prefers an explicit include list", () => {
    expect(statusFilterToSpec({ include: ["public"] }, "studies")).toEqual({
      column: "status",
      operator: "in",
      values: ["PUBLIC"],
    });
  });
});
